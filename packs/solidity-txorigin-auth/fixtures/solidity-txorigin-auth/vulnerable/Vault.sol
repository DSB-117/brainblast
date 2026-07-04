// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vault {
    address owner;

    // VULNERABLE: tx.origin auth — a relaying contract the owner calls passes this.
    function withdraw() public {
        require(tx.origin == owner, "not owner");
        payable(owner).transfer(address(this).balance);
    }
}
