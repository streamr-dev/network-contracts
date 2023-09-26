// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../SponsorshipPolicies/IAllocationPolicy.sol";
import "../Sponsorship.sol";

contract TestAllocationPolicy is IAllocationPolicy, Sponsorship {
    struct LocalStorage {
        bool failOnjoin;
        bool failOnLeave;
        bool failEmptyOnjoin;
        bool failEmptyOnLeave;
        bool failOnIncrease;
        bool failEmptyOnIncrease;
        bool sendDataWithFailInGetInsolvencyTimestamp;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("sponsorship.storage.TestAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint testCase) external {
        if (testCase == 1) {
            require(false, "test_setParam");
        } else if (testCase == 2) {
            require(false); // solhint-disable-line reason-string
        } else if (testCase == 3) {
            localData().failOnjoin = true;
        } else if (testCase == 4) {
            localData().failEmptyOnjoin = true;
        } else if (testCase == 5) {
            localData().failOnLeave = true;
        } else if (testCase == 6) {
            localData().failEmptyOnLeave = true;
        } else if (testCase == 7) {
            localData().failOnIncrease = true;
        } else if (testCase == 8) {
            localData().failEmptyOnIncrease = true;
        } else if (testCase == 9) {
            localData().sendDataWithFailInGetInsolvencyTimestamp = true;
        }
    }

    // solc-ignore-next-line func-mutability
    function onJoin(address) external {
        if (localData().failOnjoin) {
            require(false, "test_onJoin");
        } else if (localData().failEmptyOnjoin) {
            require(false); // solhint-disable-line reason-string
        }
    }

    // solc-ignore-next-line func-mutability
    function onLeave(address /*operator*/) external {
        if (localData().failOnLeave) {
            require(false, "test_onLeave");
        } else if (localData().failEmptyOnLeave) {
            require(false); // solhint-disable-line reason-string
        }
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getInsolvencyTimestamp() public override view returns (uint horizonSeconds) {
        // return 2**255; // indefinitely solvent
        if (localData().sendDataWithFailInGetInsolvencyTimestamp) {
            require(false, "test_getInsolvencyTimestamp");
        }
        require(false);
    }

    /**
     * When stake changes, effectively do a leave + join, resetting the CE for this operator
     */
    function onStakeChange(address, int) external view {
        if (localData().failOnIncrease) {
            require(false, "test_onStakeChange");
        } else if (localData().failEmptyOnIncrease) {
            require(false); // solhint-disable-line reason-string
        }
    }

    function onWithdraw(address) external pure returns (uint payoutWei) {
        return 0;
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint) {
    }

    function onSponsor(address, uint) external {
    }

    function getEarningsWei(address) public view returns (uint earningsWei) {
    }

    function calculatePenaltyOnStake(address) external view returns (uint stake) {
    }
}