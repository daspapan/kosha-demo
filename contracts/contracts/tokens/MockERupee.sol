// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockERupee
/// @notice Stand-in for the RBI e-Rupee in a local demo. No value, not legal tender.
contract MockERupee is ERC20, Ownable {
    constructor(address mockRbi) ERC20("Mock e-Rupee", "eINR") Ownable(mockRbi) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
