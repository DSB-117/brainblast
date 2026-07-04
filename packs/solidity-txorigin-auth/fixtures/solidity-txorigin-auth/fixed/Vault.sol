// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vault {
    address owner;

    // FIXED: msg.sender is the immediate caller — a relaying contract cannot pass this.
    function withdraw() public {
        require(msg.sender == owner, "not owner");
        payable(owner).transfer(address(this).balance);
    }
}
