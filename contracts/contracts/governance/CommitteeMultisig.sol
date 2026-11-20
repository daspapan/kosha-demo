// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title CommitteeMultisig
/// @notice 2-of-3 risk committee. Two confirmations schedule an operation on the
///         TimelockController; nothing executes before the timelock delay passes.
///         Any single member can cancel (veto), because stopping money is the safe direction.
///         Each proposal carries a proposalHash: the SHA-256 of the AI proposal and data snapshot.
contract CommitteeMultisig {
    uint256 public constant THRESHOLD = 2;

    struct Proposal {
        address target;
        uint256 value;
        bytes data;
        bytes32 salt;
        bytes32 proposalHash;
        uint8 confirmations;
        bool scheduled;
        bool cancelled;
    }

    TimelockController public immutable timelock;
    address[3] public owners;
    mapping(address => bool) public isOwner;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;
    uint256 public nextProposalId = 1;

    event Submitted(uint256 indexed id, address indexed by, address target, bytes data, bytes32 proposalHash);
    event Confirmed(uint256 indexed id, address indexed by, uint8 confirmations);
    event Revoked(uint256 indexed id, address indexed by, uint8 confirmations);
    event Scheduled(uint256 indexed id, bytes32 indexed operationId, uint256 readyAt);
    event Cancelled(uint256 indexed id, address indexed by);
    event OwnerReplaced(address indexed oldOwner, address indexed newOwner);

    error NotOwner();
    error NotTimelock();
    error BadOwners();
    error UnknownProposal(uint256 id);
    error AlreadyConfirmed();
    error NotConfirmed();
    error ProposalClosed(uint256 id);

    constructor(TimelockController timelock_, address[3] memory owners_) {
        timelock = timelock_;
        for (uint256 i = 0; i < 3; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert BadOwners();
            isOwner[o] = true;
            owners[i] = o;
        }
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    function submit(address target, uint256 value, bytes calldata data, bytes32 salt, bytes32 proposalHash)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = nextProposalId++;
        Proposal storage p = _proposals[id];
        p.target = target;
        p.value = value;
        p.data = data;
        p.salt = salt;
        p.proposalHash = proposalHash;
        emit Submitted(id, msg.sender, target, data, proposalHash);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner {
        _confirm(id);
    }

    function revoke(uint256 id) external onlyOwner {
        Proposal storage p = _open(id);
        if (!confirmedBy[id][msg.sender]) revert NotConfirmed();
        confirmedBy[id][msg.sender] = false;
        p.confirmations -= 1;
        emit Revoked(id, msg.sender, p.confirmations);
    }

    /// @notice One member is enough to stop a proposal, before or after it is scheduled.
    function cancel(uint256 id) external onlyOwner {
        Proposal storage p = _proposals[id];
        if (p.target == address(0)) revert UnknownProposal(id);
        if (p.cancelled) revert ProposalClosed(id);
        if (p.scheduled) {
            bytes32 op = operationId(id);
            if (timelock.isOperationDone(op)) revert ProposalClosed(id);
            timelock.cancel(op);
        }
        p.cancelled = true;
        emit Cancelled(id, msg.sender);
    }

    /// @notice Lost-key recovery. Only callable by the timelock, so it needs 2-of-3 and the delay.
    function replaceOwner(address oldOwner, address newOwner) external {
        if (msg.sender != address(timelock)) revert NotTimelock();
        if (!isOwner[oldOwner] || newOwner == address(0) || isOwner[newOwner]) revert BadOwners();
        for (uint256 i = 0; i < 3; i++) {
            if (owners[i] == oldOwner) owners[i] = newOwner;
        }
        isOwner[oldOwner] = false;
        isOwner[newOwner] = true;
        emit OwnerReplaced(oldOwner, newOwner);
    }

    function operationId(uint256 id) public view returns (bytes32) {
        Proposal storage p = _proposals[id];
        return timelock.hashOperation(p.target, p.value, p.data, bytes32(0), p.salt);
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }

    function _open(uint256 id) internal view returns (Proposal storage p) {
        p = _proposals[id];
        if (p.target == address(0)) revert UnknownProposal(id);
        if (p.scheduled || p.cancelled) revert ProposalClosed(id);
    }

    function _confirm(uint256 id) internal {
        Proposal storage p = _open(id);
        if (confirmedBy[id][msg.sender]) revert AlreadyConfirmed();
        confirmedBy[id][msg.sender] = true;
        p.confirmations += 1;
        emit Confirmed(id, msg.sender, p.confirmations);
        if (p.confirmations >= THRESHOLD) {
            p.scheduled = true;
            uint256 delay = timelock.getMinDelay();
            timelock.schedule(p.target, p.value, p.data, bytes32(0), p.salt, delay);
            emit Scheduled(id, operationId(id), block.timestamp + delay);
        }
    }
}
