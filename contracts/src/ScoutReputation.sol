// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ScoutReputation
/// @notice Tracks how often each human responder agreed with consensus.
/// @dev This is the accuracy mechanism for Scout, and it exists because the obvious
///      alternative is wrong for this market. Stake-and-slash would require a worker
///      earning $0.05 per task to lock up capital, which inverts the economics and
///      excludes exactly the people the product is for. Withholding payment from an
///      outlier is already a sufficient penalty; this contract makes that penalty
///      persistent so dispatch can prefer responders with a track record.
///
///      Shape intentionally mirrors ERC-8004's reputation registry so it can be
///      migrated to the standard rather than replaced.
contract ScoutReputation {
    // --- Storage ---

    address public owner;

    /// @notice Net score. Rises on agreement, falls on disagreement, may go negative.
    mapping(address => int64) public score;
    /// @notice Total settled responses by this address.
    mapping(address => uint32) public answered;
    /// @notice How many of those were in consensus.
    mapping(address => uint32) public agreed;
    /// @notice Contracts permitted to write history (the escrow).
    mapping(address => bool) public isWriter;

    // --- Events ---

    event Recorded(address indexed responder, bool inConsensus, int64 newScore);
    event WriterUpdated(address indexed writer, bool allowed);
    event OwnerUpdated(address indexed newOwner);

    // --- Errors ---

    error NotOwner();
    error NotWriter();
    error ZeroAddress();

    // --- Setup ---

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerUpdated(owner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // --- Write path ---

    /// @notice Record one settled response. Called by the escrow during settlement.
    function record(address responder, bool inConsensus) external {
        if (!isWriter[msg.sender]) revert NotWriter();

        answered[responder] += 1;
        if (inConsensus) {
            agreed[responder] += 1;
            score[responder] += 1;
        } else {
            score[responder] -= 1;
        }

        emit Recorded(responder, inConsensus, score[responder]);
    }

    // --- Views ---

    /// @notice Hit rate in basis points, for reputation-weighted dispatch.
    /// @return Accuracy in bps (10000 = every response agreed with consensus).
    ///         Returns 0 for an address with no history, which makes an unproven
    ///         responder indistinguishable from a bad one. The router is responsible
    ///         for reserving a share of slots to newcomers so they can build a record.
    function accuracyBps(address responder) external view returns (uint16) {
        uint32 total = answered[responder];
        if (total == 0) return 0;
        return uint16((uint256(agreed[responder]) * 10_000) / uint256(total));
    }

    // --- Admin ---

    function setWriter(address writer, bool allowed) external onlyOwner {
        if (writer == address(0)) revert ZeroAddress();
        isWriter[writer] = allowed;
        emit WriterUpdated(writer, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }
}
