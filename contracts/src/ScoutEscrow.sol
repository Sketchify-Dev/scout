// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20, IERC3009, IHumanRegistry, IScoutReputation, Authorization} from "./Interfaces.sol";

/// @title ScoutEscrow
/// @notice Holds a stablecoin bounty while verified humans answer a question an AI
///         agent cannot answer on its own, then pays the responders who agreed.
///
/// @dev Design notes a reviewer should know up front:
///
///      1. Answer hashes go to storage, full answer text goes to events. Events are
///         far cheaper than storing arbitrary-length strings and CeloScan renders
///         them, so the complete audit trail is public without paying storage costs.
///
///      2. Responders submit their own transactions. On Celo the gas for this is a
///         small fraction of a cent and can be paid in the same stablecoin being
///         earned (fee abstraction), so a relayer is not needed to make a $0.05 task
///         worthwhile.
///
///      3. The verifier is a single trusted address in v1. That is a real
///         centralization assumption, so `forceSettle` exists to bound it: if the
///         verifier goes dark, anyone can pay the humans who already did the work.
///
///      4. Assumes a standard non-rebasing, non-fee-on-transfer ERC-20 (USDC).
///
///      Dependency-free by choice: no imports beyond our own interfaces, so a judge
///      can read it end to end and it compiles without fetching anything.
contract ScoutEscrow {
    // --- Types ---

    enum Status {
        None, // never created
        Open, // accepting responses
        Settled, // verifier paid out
        Refunded // expired with no responses, requester reclaimed
    }

    struct Bounty {
        address requester; // agent that paid for the answer
        address token; // settlement asset (USDC on Celo)
        uint96 rewardPerResponse; // paid to each in-consensus responder
        uint64 deadline; // responses rejected at or after this timestamp
        uint8 responsesRequired; // how many independent humans are wanted
        uint8 responsesReceived;
        Status status;
        bytes32 promptHash; // keccak256 of the question, full text in the event
    }

    struct Response {
        address responder;
        bytes32 answerHash; // keccak256 of the answer, full text in the event
        uint64 submittedAt;
    }

    // --- Constants ---

    /// @notice Caps every loop in this contract, so settlement gas is bounded.
    uint8 public constant MAX_RESPONSES = 32;

    /// @notice After deadline + this window, an unsettled bounty with responses can be
    ///         force-settled by anyone. This is the liveness backstop on the verifier.
    uint64 public constant SETTLEMENT_GRACE = 3 days;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Celo attribution tag for "Agents on Open Rails" (Loops House).
    ///         Only Celo Mainnet counts for prizes and leaderboard. Testnet is for
    ///         building only. This on-chain constant is a backup marker. The binding
    ///         attribution is the ERC-8021 tag appended to each transaction calldata
    ///         by the frontend and bot backend before the first countable action,
    ///         plus the PayTo wallet registered for x402 deals.
    string public constant BUILDER_TAG = "celo_0107eaa60597";

    // --- Storage ---

    address public owner;
    address public verifier;
    IHumanRegistry public humanRegistry;
    IScoutReputation public reputation;

    uint256 public nextBountyId = 1;

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => Response[]) private _responses;
    mapping(uint256 => mapping(address => bool)) public hasResponded;

    /// @notice token => account => amount owed after a failed push payment.
    mapping(address => mapping(address => uint256)) public claimable;

    uint256 private _entered;

    // --- Events ---

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed requester,
        address indexed token,
        uint96 rewardPerResponse,
        uint8 responsesRequired,
        uint64 deadline,
        bytes32 promptHash,
        string prompt
    );
    event ResponseSubmitted(
        uint256 indexed bountyId,
        address indexed responder,
        uint256 responseIndex,
        bytes32 answerHash,
        string answer
    );
    event BountySettled(
        uint256 indexed bountyId,
        uint16 confidenceBps,
        uint256 paidCount,
        uint256 refunded,
        bytes32 consensusAnswerHash,
        bool forced
    );
    event ResponderPaid(uint256 indexed bountyId, address indexed responder, address indexed token, uint256 amount);
    event PayoutDeferred(uint256 indexed bountyId, address indexed recipient, address indexed token, uint256 amount);
    event Refunded(uint256 indexed bountyId, address indexed requester, uint256 amount);
    event Claimed(address indexed account, address indexed token, uint256 amount);
    event VerifierUpdated(address indexed verifier);
    event HumanRegistryUpdated(address indexed registry);
    event ReputationUpdated(address indexed reputation);
    event OwnerUpdated(address indexed newOwner);
    event ScoutAttribution(string tag, address indexed contractAddress);

    // --- Errors ---

    error NotOwner();
    error NotVerifier();
    error NotVerifiedHuman();
    error BountyNotOpen();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error GraceNotElapsed();
    error AlreadyResponded();
    error ResponsesFull();
    error HasResponses();
    error InvalidParams();
    error IndexOutOfRange();
    error IndicesNotSorted();
    error Reentrancy();
    error TransferFailed();
    error NothingToClaim();

    // --- Setup ---

    constructor(address owner_, address verifier_, address humanRegistry_, address reputation_) {
        if (owner_ == address(0) || verifier_ == address(0)) revert InvalidParams();
        owner = owner_;
        verifier = verifier_;
        humanRegistry = IHumanRegistry(humanRegistry_); // may be zero to disable the gate
        reputation = IScoutReputation(reputation_); // may be zero to disable recording
        emit OwnerUpdated(owner_);
        emit VerifierUpdated(verifier_);
        emit HumanRegistryUpdated(humanRegistry_);
        emit ReputationUpdated(reputation_);
        emit ScoutAttribution(BUILDER_TAG, address(this));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    // --- Creating bounties ---

    /// @notice Post a bounty, funded with approve + transferFrom. Works with any ERC-20.
    /// @param prompt The question, in full. Stored only as a hash; the text lives in the log.
    function createBounty(
        address token,
        uint96 rewardPerResponse,
        uint8 responsesRequired,
        uint64 deadline,
        string calldata prompt
    ) external nonReentrant returns (uint256 bountyId) {
        uint256 total = _validateNewBounty(token, rewardPerResponse, responsesRequired, deadline);

        // Pull the whole payout up front. A bounty is never partially funded: a human
        // deciding whether to do the work must be able to see the money is already here.
        if (!_transferFrom(token, msg.sender, address(this), total)) revert TransferFailed();

        bountyId = _recordBounty(msg.sender, token, rewardPerResponse, responsesRequired, deadline, prompt);
    }

    /// @notice Post a bounty funded by an off-chain EIP-3009 authorization, so the
    ///         requester agent needs no gas and no prior approval. This is the
    ///         x402-native path: the same signed authorization that settles the A2A
    ///         service payment funds the human payout.
    /// @dev UNVERIFIED against the deployed Celo USDC. Check that the token implements
    ///      EIP-3009 before the demo relies on this. `createBounty` is the fallback.
    /// @param auth The requester's signed authorization. `auth.from` becomes the
    ///             bounty's requester, so the router can submit on the agent's behalf.
    function createBountyWithAuthorization(
        address token,
        uint96 rewardPerResponse,
        uint8 responsesRequired,
        uint64 deadline,
        string calldata prompt,
        Authorization calldata auth
    ) external nonReentrant returns (uint256 bountyId) {
        uint256 total = _validateNewBounty(token, rewardPerResponse, responsesRequired, deadline);

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC3009(token).receiveWithAuthorization(
            auth.from, address(this), total, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
        // Verify the funds actually arrived rather than trusting a silent no-op.
        if (IERC20(token).balanceOf(address(this)) - balanceBefore < total) revert TransferFailed();

        bountyId = _recordBounty(auth.from, token, rewardPerResponse, responsesRequired, deadline, prompt);
    }

    // --- Responding ---

    /// @notice Submit an answer. Callable once per verified human per bounty.
    function submitResponse(uint256 bountyId, string calldata answer) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();
        if (b.responsesReceived >= b.responsesRequired) revert ResponsesFull();
        if (hasResponded[bountyId][msg.sender]) revert AlreadyResponded();

        // Sybil resistance is proof of personhood, not capital at risk. Without this
        // gate one operator farms every slot on a bounty and defines its own consensus.
        IHumanRegistry registry = humanRegistry;
        if (address(registry) != address(0) && !registry.isVerifiedHuman(msg.sender)) {
            revert NotVerifiedHuman();
        }

        hasResponded[bountyId][msg.sender] = true;

        bytes32 answerHash = keccak256(bytes(answer));
        uint256 index = _responses[bountyId].length;
        _responses[bountyId].push(
            Response({responder: msg.sender, answerHash: answerHash, submittedAt: uint64(block.timestamp)})
        );
        b.responsesReceived = uint8(index + 1);

        emit ResponseSubmitted(bountyId, msg.sender, index, answerHash, answer);
    }

    // --- Settlement ---

    /// @notice Pay the responders the verifier judged to be in consensus.
    /// @param consensusIndices Response indices to pay, strictly increasing. Sorting is
    ///        required because it validates range and rejects duplicates in a single
    ///        pass, so the verifier cannot pay one responder twice.
    /// @param confidenceBps How much the verifier trusts the consensus answer, returned
    ///        to the requester alongside the answer itself.
    /// @param consensusAnswerHash Hash of the agreed answer, for public audit.
    function settle(
        uint256 bountyId,
        uint256[] calldata consensusIndices,
        uint16 confidenceBps,
        bytes32 consensusAnswerHash
    ) external onlyVerifier nonReentrant {
        _settle(bountyId, consensusIndices, confidenceBps, consensusAnswerHash, false);
    }

    /// @notice Liveness backstop. Once the deadline plus grace has elapsed on a bounty
    ///         that still has not been settled, anyone can pay every responder.
    /// @dev The humans did the work; a verifier that went offline must not be able to
    ///      strand their earnings. The requester chose the verifier, so the requester
    ///      bears the cost of that choice. Confidence is reported as zero because no
    ///      consensus was ever computed, which keeps the signal honest.
    function forceSettle(uint256 bountyId) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (block.timestamp < uint256(b.deadline) + SETTLEMENT_GRACE) revert GraceNotElapsed();

        uint256 received = b.responsesReceived;
        if (received == 0) revert HasResponses(); // nothing owed; use refundExpired

        uint256[] memory all = new uint256[](received);
        for (uint256 i = 0; i < received; ++i) {
            all[i] = i;
        }
        _settleMemory(bountyId, all, 0, bytes32(0), true);
    }

    /// @notice Reclaim a bounty that expired without a single response.
    /// @dev Permissionless so the requester cannot be griefed by inaction, and limited
    ///      to the no-response case so it can never cancel work already performed.
    function refundExpired(uint256 bountyId) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (block.timestamp < b.deadline) revert DeadlineNotPassed();
        if (b.responsesReceived != 0) revert HasResponses();

        b.status = Status.Refunded;

        uint256 total = uint256(b.rewardPerResponse) * uint256(b.responsesRequired);
        address token = b.token;
        address requester = b.requester;

        if (_push(token, requester, total)) {
            emit Refunded(bountyId, requester, total);
        } else {
            emit PayoutDeferred(bountyId, requester, token, total);
        }
    }

    /// @notice Withdraw funds credited after a failed push payment.
    function claim(address token) external nonReentrant {
        uint256 amount = claimable[token][msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[token][msg.sender] = 0;
        if (!_transfer(token, msg.sender, amount)) revert TransferFailed();

        emit Claimed(msg.sender, token, amount);
    }

    // --- Views ---

    function getResponses(uint256 bountyId) external view returns (Response[] memory) {
        return _responses[bountyId];
    }

    function responseCount(uint256 bountyId) external view returns (uint256) {
        return _responses[bountyId].length;
    }

    /// @notice Total still escrowed for a bounty, zero once settled or refunded.
    function escrowedAmount(uint256 bountyId) external view returns (uint256) {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) return 0;
        return uint256(b.rewardPerResponse) * uint256(b.responsesRequired);
    }

    // --- Admin ---

    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert InvalidParams();
        verifier = verifier_;
        emit VerifierUpdated(verifier_);
    }

    /// @dev Zero address disables the personhood gate. Useful on a local chain, never
    ///      acceptable in production.
    function setHumanRegistry(address registry) external onlyOwner {
        humanRegistry = IHumanRegistry(registry);
        emit HumanRegistryUpdated(registry);
    }

    /// @dev Zero address disables reputation recording. Also the escape hatch if a bad
    ///      reputation contract ever reverts and blocks settlement.
    function setReputation(address reputation_) external onlyOwner {
        reputation = IScoutReputation(reputation_);
        emit ReputationUpdated(reputation_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidParams();
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    // --- Internals ---

    function _validateNewBounty(address token, uint96 rewardPerResponse, uint8 responsesRequired, uint64 deadline)
        private
        view
        returns (uint256 total)
    {
        if (
            token == address(0) || rewardPerResponse == 0 || responsesRequired == 0
                || responsesRequired > MAX_RESPONSES || deadline <= block.timestamp
        ) revert InvalidParams();

        total = uint256(rewardPerResponse) * uint256(responsesRequired);
    }

    function _recordBounty(
        address requester,
        address token,
        uint96 rewardPerResponse,
        uint8 responsesRequired,
        uint64 deadline,
        string calldata prompt
    ) private returns (uint256 bountyId) {
        bountyId = nextBountyId++;
        bytes32 promptHash = keccak256(bytes(prompt));

        bounties[bountyId] = Bounty({
            requester: requester,
            token: token,
            rewardPerResponse: rewardPerResponse,
            deadline: deadline,
            responsesRequired: responsesRequired,
            responsesReceived: 0,
            status: Status.Open,
            promptHash: promptHash
        });

        emit BountyCreated(
            bountyId, requester, token, rewardPerResponse, responsesRequired, deadline, promptHash, prompt
        );
    }

    function _settle(
        uint256 bountyId,
        uint256[] calldata consensusIndices,
        uint16 confidenceBps,
        bytes32 consensusAnswerHash,
        bool forced
    ) private {
        uint256[] memory indices = new uint256[](consensusIndices.length);
        for (uint256 i = 0; i < consensusIndices.length; ++i) {
            indices[i] = consensusIndices[i];
        }
        _settleMemory(bountyId, indices, confidenceBps, consensusAnswerHash, forced);
    }

    function _settleMemory(
        uint256 bountyId,
        uint256[] memory consensusIndices,
        uint16 confidenceBps,
        bytes32 consensusAnswerHash,
        bool forced
    ) private {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (confidenceBps > BPS_DENOMINATOR) revert InvalidParams();

        uint256 received = b.responsesReceived;
        uint256 payCount = consensusIndices.length;
        if (payCount > received) revert InvalidParams();

        // Flip status before any external call.
        b.status = Status.Settled;

        address token = b.token;
        uint256 reward = uint256(b.rewardPerResponse);
        Response[] storage responses = _responses[bountyId];

        // One pass validates range, rejects duplicates via strict ordering, and builds
        // a membership bitmap for the reputation pass. MAX_RESPONSES is 32 so this
        // always fits in a single word.
        uint256 consensusMask;
        for (uint256 i = 0; i < payCount; ++i) {
            uint256 index = consensusIndices[i];
            if (index >= received) revert IndexOutOfRange();
            if (i != 0 && index <= consensusIndices[i - 1]) revert IndicesNotSorted();
            consensusMask |= (uint256(1) << index);
        }

        for (uint256 i = 0; i < payCount; ++i) {
            address responder = responses[consensusIndices[i]].responder;
            if (_push(token, responder, reward)) {
                emit ResponderPaid(bountyId, responder, token, reward);
            } else {
                emit PayoutDeferred(bountyId, responder, token, reward);
            }
        }

        // Agreement earns score, disagreement loses it. Nothing is slashed.
        IScoutReputation rep = reputation;
        if (address(rep) != address(0)) {
            for (uint256 i = 0; i < received; ++i) {
                rep.record(responses[i].responder, ((consensusMask >> i) & 1) == 1);
            }
        }

        // Unfilled slots and outlier rewards go back to the requester.
        uint256 refund = (uint256(b.rewardPerResponse) * uint256(b.responsesRequired)) - (reward * payCount);
        if (refund != 0) {
            address requester = b.requester;
            if (_push(token, requester, refund)) {
                emit Refunded(bountyId, requester, refund);
            } else {
                emit PayoutDeferred(bountyId, requester, token, refund);
            }
        }

        emit BountySettled(bountyId, confidenceBps, payCount, refund, consensusAnswerHash, forced);
    }

    /// @dev Push payment that never lets one unreachable recipient block the others.
    ///      On failure the amount is credited for later `claim()`.
    function _push(address token, address to, uint256 amount) private returns (bool pushed) {
        pushed = _transfer(token, to, amount);
        if (!pushed) {
            claimable[token][to] += amount;
        }
    }

    /// @dev Tolerates tokens that return no data on success, as some ERC-20s do.
    function _transfer(address token, address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _transferFrom(address token, address from, address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }
}
