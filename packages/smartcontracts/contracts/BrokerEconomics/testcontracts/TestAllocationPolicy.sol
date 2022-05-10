// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "../policies/IAllocationPolicy.sol";
import "../Bounty.sol";


contract TestAllocationPolicy is IAllocationPolicy, Bounty {
    struct LocalStorage {
        bool failOnjoin;
        bool failOnLeave;
        bool failEmptyOnjoin;
        bool failEmptyOnLeave;
        bool failOnIncrease;
        bool failEmptyOnIncrease;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.StakeWeightedAllocationPolicy", address(this)));
        assembly {data.slot := storagePosition}
    }

    function setParam(uint256 earningsWeiPerSecond) external {
        if (earningsWeiPerSecond == 1) {
            require(false, "test-error: setting param allocation policy");
        } else if (earningsWeiPerSecond == 2) {
            localData().failOnjoin = true;
        } else if (earningsWeiPerSecond == 3) {
            localData().failOnLeave = true;
        } else if (earningsWeiPerSecond == 4) {
            require(false);
        } else if (earningsWeiPerSecond == 5) {
            localData().failEmptyOnjoin = true;
        } else if (earningsWeiPerSecond == 6) {
            localData().failEmptyOnLeave = true;
        } else if (earningsWeiPerSecond == 7) {
            localData().failOnIncrease = true;
        } else if (earningsWeiPerSecond == 8) {
            localData().failEmptyOnIncrease = true;
        }
    }

    function onJoin(address /*broker*/) external view {
        if (localData().failOnjoin) {
            require(false, "test-error: onJoin allocation policy");
        } else if (localData().failEmptyOnjoin) {
            require(false);
        }
    }

    function onLeave(address /*broker*/) external view {
        if (localData().failOnLeave) {
            require(false, "test-error: onLeave allocation policy");
        } else if (localData().failEmptyOnLeave) {
            require(false);
        }
    }

    /** Horizon means how long time the (unallocated) funds are going to still last */
    function getHorizonSeconds() public override pure returns (uint256 horizonSeconds) {
        return 2**256 - 1; // max uint256
        // return 1;
    }

    /**
     * When stake changes, effectively do a leave + join, resetting the CE for this broker
     */
    function onStakeIncrease(address) external view {
        if (localData().failOnIncrease) {
            require(false, "test-error: onStakeIncrease allocation policy");
        } else if (localData().failEmptyOnIncrease) {
            require(false);
        }
    }

    /** Calculate the cumulative earnings per unit (full token stake) right now */
    function getCumulativeEarnings() internal view returns(uint256) {
    }

    /**
     * Update the localData so that all subsequent calculations can use localData().cumulativeEarningsPerStake
     * This should be called before/during changes that affect incomePerSecondPerStake (total staked, earnings velocity) which is that "slope of the cumulative earnings curve"
     */
    function updateCumulativeEarnings() private {
    }

    function calculateAllocation(address broker) public view returns (uint allocation) {
    }

    function calculatePenaltyOnStake(address broker) external view returns (uint256 stake) {
    }
}