// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title KoshaTimelock
/// @notice OpenZeppelin TimelockController. The deploy script wires roles with a temporary
///         admin and then renounces it, leaving the timelock self-administered.
contract KoshaTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address tempAdmin)
        TimelockController(minDelay, proposers, executors, tempAdmin)
    {}
}
