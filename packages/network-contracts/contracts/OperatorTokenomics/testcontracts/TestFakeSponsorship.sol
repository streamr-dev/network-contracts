// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

/**
 * Minimal "sponsorship" that was NOT deployed by the SponsorshipFactory and that the Operator is NOT staked in.
 * Its withdraw() returns whatever number the caller has set, but never transfers any DATA tokens.
 * Models the fake sponsorship used in the 2026-10-09 Operator drain: Operator._withdrawEarnings trusted the return value
 * of withdraw() and paid out protocol fee + fisherman reward from the Operator's own DATA balance.
 */
contract TestFakeSponsorship {
    uint public fakeEarningsWei;

    function setFakeEarnings(uint fakeEarningsWei_) external {
        fakeEarningsWei = fakeEarningsWei_;
    }

    function withdraw() external view returns (uint payoutWei) {
        return fakeEarningsWei;
    }
}
