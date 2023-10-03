import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import type { Wallet } from "ethers"
import type { StreamrConfig } from "../../../typechain"
import { parseEther } from "ethers/lib/utils"

const { getSigners, getContractFactory } = hardhatEthers

describe("StreamrConfig", (): void => {
    let admin: Wallet
    let notAdmin: Wallet
    let streamrConfig: StreamrConfig

    before(async (): Promise<void> => {
        [admin, notAdmin] = await getSigners() as Wallet[]
        streamrConfig = await (await getContractFactory("StreamrConfig", { signer: admin })).deploy() as StreamrConfig
        await (await streamrConfig.initialize()).wait()
    })

    describe("Limitations of config values", (): void => {
        // restore after these modifications
        after(async (): Promise<void> => {
            streamrConfig = await (await getContractFactory("StreamrConfig", { signer: admin })).deploy() as StreamrConfig
            await (await streamrConfig.initialize()).wait()
        })

        // test order may be important since they all use the same StreamrConfig instance: first test ones that depend on others
        it("flagStakeWei", async (): Promise<void> => {
            await expect(streamrConfig.setFlagStakeWei(parseEther("1")))
                .to.be.revertedWithCustomError(streamrConfig, "TooLow")
            await expect(streamrConfig.setFlagStakeWei(parseEther("10"))).to.not.be.reverted
        })
        it("maxQueueSeconds < maxPenaltyPeriodSeconds", async (): Promise<void> => {
            await expect(streamrConfig.setMaxQueueSeconds(3600 * 24 * 14))
                .to.be.revertedWithCustomError(streamrConfig, "TooLow")
            await expect(streamrConfig.setMaxQueueSeconds(3600 * 24 * 14 + 1)).to.not.be.reverted
        })
        it("flagReviewerSelectionIterations >= reviewerCount", async (): Promise<void> => {
            await expect(streamrConfig.setFlagReviewerSelectionIterations(4))
                .to.be.revertedWithCustomError(streamrConfig, "TooLow")
            await expect(streamrConfig.setFlagReviewerSelectionIterations(5)).to.not.be.reverted
        })

        // ...then let the ones that don't depend on others change
        it("slashingFraction <= 100%", async (): Promise<void> => {
            await expect(streamrConfig.setSlashingFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(streamrConfig, "TooHigh")
            await expect(streamrConfig.setSlashingFraction("1000000000000000000")).to.not.be.reverted
        })
        it("minimumSelfDelegationFraction <= 100%", async (): Promise<void> => {
            await expect(streamrConfig.setMinimumSelfDelegationFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(streamrConfig, "TooHigh")
            await expect(streamrConfig.setMinimumSelfDelegationFraction("1000000000000000000")).to.not.be.reverted
        })
        it("protocolFeeFraction <= 100%", async (): Promise<void> => {
            await expect(streamrConfig.setProtocolFeeFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(streamrConfig, "TooHigh")
            await expect(streamrConfig.setProtocolFeeFraction("1000000000000000000")).to.not.be.reverted
        })
        it("maxAllowedEarningsFraction <= 100%", async (): Promise<void> => {
            await expect(streamrConfig.setMaxAllowedEarningsFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(streamrConfig, "TooHigh")
            await expect(streamrConfig.setMaxAllowedEarningsFraction("1000000000000000000")).to.not.be.reverted
        })
        it("fishermanRewardFraction <= 100%", async (): Promise<void> => {
            await expect(streamrConfig.setFishermanRewardFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(streamrConfig, "TooHigh")
            await expect(streamrConfig.setFishermanRewardFraction("1000000000000000000")).to.not.be.reverted
        })
        it("flagReviewerCount > 0", async (): Promise<void> => {
            await expect(streamrConfig.setFlagReviewerCount(0))
                .to.be.revertedWithCustomError(streamrConfig, "TooLow")
            await expect(streamrConfig.setFlagReviewerCount(1)).to.not.be.reverted

            // setting flag reviewer count also bumps up iterations, otherwise we couldn't get so many reviewers
            await (await streamrConfig.setFlagReviewerCount(10)).wait()
            expect(await streamrConfig.flagReviewerSelectionIterations()).to.equal(10)
        })
    })

    describe("Access control", (): void => {
        it("only lets admin call setters", async (): Promise<void> => {
            await expect(streamrConfig.connect(notAdmin).setSponsorshipFactory(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setOperatorFactory(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setSlashingFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setOperatorContractOnlyJoinPolicy(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setStreamRegistryAddress(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMinimumDelegationWei("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMinimumSelfDelegationFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMaxPenaltyPeriodSeconds("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMaxAllowedEarningsFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFishermanRewardFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setProtocolFeeFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setProtocolFeeBeneficiary(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlagReviewerCount("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMaxQueueSeconds("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlagReviewerRewardWei("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlaggerRewardWei("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlagReviewerSelectionIterations("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlagStakeWei("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setReviewPeriodSeconds("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setVotingPeriodSeconds("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setFlagProtectionSeconds("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setMinimumSelfDelegationFraction("0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(streamrConfig.connect(notAdmin).setRandomOracle(admin.address))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
        })

        it("prevents calling initialize", async (): Promise<void> => {
            await expect(streamrConfig.initialize())
                .to.be.revertedWith("Initializable: contract is already initialized")
            await expect(streamrConfig.connect(notAdmin).initialize())
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
})
