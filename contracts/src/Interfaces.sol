// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal ERC-20 surface. Declared locally rather than imported from
///         OpenZeppelin so this repo compiles without fetching any dependency.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice An off-chain signed transfer authorization, the primitive that x402's
///         `exact` scheme is built on. Lets a requester agent fund a bounty without
///         ever holding gas.
struct Authorization {
    address from;
    uint256 validAfter;
    uint256 validBefore;
    bytes32 nonce;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

/// @notice EIP-3009 gasless transfers.
/// @dev `receiveWithAuthorization` (not `transferWithAuthorization`) is the correct
///      entry point here: it requires msg.sender == to, which is what stops a third
///      party from front-running a signed authorization into a different destination.
///
///      UNVERIFIED: whether the USDC deployment on Celo actually implements this.
///      Confirm before the demo depends on it. ScoutEscrow.createBounty is the
///      approve + transferFrom fallback that works with any plain ERC-20.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice Proof of personhood gate. One human, one responder address.
/// @dev Deliberately our own interface, not Self Protocol's. Self's real verification
///      API was unreadable when this was written (network outage), so the adapter that
///      bridges Self to this interface is an isolated change that cannot ripple into
///      the escrow logic.
interface IHumanRegistry {
    function isVerifiedHuman(address account) external view returns (bool);
}

/// @notice Accuracy ledger for responders. Agreement earns score, disagreement loses
///         it. No stake, so nothing is ever slashed.
interface IScoutReputation {
    function record(address responder, bool inConsensus) external;
    function score(address responder) external view returns (int64);
}
