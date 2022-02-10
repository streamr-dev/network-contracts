// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./Ownable.sol";

contract NetworkParameters is Ownable {
    uint public minControlLayerVersion;
    uint public minMessageLayerVersion;
    string public minNetworkReferenceCodeVersion;
    address public tokenAddress;

    constructor(address owner, uint minControlLayerVersion_, uint minMessageLayerVersion_, string memory minNetworkReferenceCodeVersion_, address tokenAddress_) Ownable(owner) {
        minControlLayerVersion = minControlLayerVersion_;
        minMessageLayerVersion = minMessageLayerVersion_;
        minNetworkReferenceCodeVersion = minNetworkReferenceCodeVersion_;
        tokenAddress = tokenAddress_;
    }

    function setMinControlLayerVersion(uint version) public onlyOwner {
        minControlLayerVersion = version;
    }

    function setMinMessageLayerVersion(uint version) public onlyOwner {
        minControlLayerVersion = version;
    }

    function setMinNetworkReferenceCodeVersion(string memory version) public onlyOwner {
        minNetworkReferenceCodeVersion = version;
    }

    function setTokenAddress(address tokenAddress_) public onlyOwner {
        tokenAddress = tokenAddress_;
    }
}