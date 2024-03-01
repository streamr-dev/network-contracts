import { upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { TestContracts, deployTestContracts, deployStreamrConfig } from "./deployTestContracts"
import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"

import type { BigNumber, ContractFactory, Wallet } from "ethers"
import type { StreamrConfig, Operator } from "../../../typechain"

const { getSigners, getContractFactory, utils: { parseEther } } = hardhatEthers

describe("StreamrConfig", (): void => {
    let admin: Wallet
    let notAdmin: Wallet
    let sharedConfig: StreamrConfig

    before(async (): Promise<void> => {
        [admin, notAdmin] = await getSigners() as Wallet[]
        sharedConfig = await deployStreamrConfig(admin)
    })

    describe("Implications of changing config values", (): void => {
        let sharedContracts: TestContracts
        let operatorWallet: Wallet
        let operator2Wallet: Wallet

        before(async (): Promise<void> => {
            [,, operatorWallet, operator2Wallet] = await getSigners() as Wallet[]
            sharedContracts = await deployTestContracts(admin)
        })

        async function deployOperator(deployer: Wallet, selfDelegationWei: BigNumber): Promise<Operator> {
            const { token } = sharedContracts
            await (await token.mint(deployer.address, selfDelegationWei)).wait()
            const operator = await deployOperatorContract(sharedContracts, deployer)
            await (await token.connect(deployer).transferAndCall(operator.address, selfDelegationWei, "0x")).wait()
            await (await operator.setNodeAddresses([deployer.address])).wait()
            return operator
        }

        describe("Raising minimum stake", (): void => {

            // In the beginning of onFlag, if the target doesn't have enough (unlocked) stake to pay for the review,
            //   then just kick them out immediately without slashing. No one gets paid, no one gets slashed.
            // The incentive for the flagger to do this is to increase their own share ;)
            it("causes minimum-stakers to get kicked out without vote", async (): Promise<void> => {
                const { token, streamrConfig } = sharedContracts
                const minimumStakeWei = await streamrConfig.minimumStakeWei()
                const flagger = await deployOperator(operatorWallet, parseEther("100000"))
                const target = await deployOperator(operator2Wallet, minimumStakeWei)

                const sponsorship = await deploySponsorship(sharedContracts, { allocationWeiPerSecond: parseEther("0") })
                await expect(token.transferAndCall(sponsorship.address, parseEther("1000"), "0x"))
                    .to.emit(sponsorship, "SponsorshipReceived").withArgs(admin.address, parseEther("1000"))
                await expect(flagger.stake(sponsorship.address, parseEther("100000")))
                    .to.emit(flagger, "Staked").withArgs(sponsorship.address)
                    .to.emit(sponsorship, "StakeUpdate").withArgs(flagger.address, parseEther("100000"), "0")
                await expect(target.stake(sponsorship.address, minimumStakeWei))
                    .to.emit(target, "Staked").withArgs(sponsorship.address)
                    .to.emit(sponsorship, "StakeUpdate").withArgs(target.address, minimumStakeWei, "0")

                // raise the targetStakeAtRiskWei by raising minimum stake by setting higher reviewer rewards
                // minimum stake goes up to 73600.0, slashingFraction of that is 7360 > 5000 that `target` staked
                await (await streamrConfig.setFlagStakeWei(parseEther("100000"))).wait()
                await (await streamrConfig.setFlagReviewerRewardWei(parseEther("1000"))).wait()

                // target is kicked out without a vote
                await expect(flagger.flag(sponsorship.address, target.address, "{}"))
                    .to.emit(sponsorship, "OperatorKicked").withArgs(target.address)
                    .to.not.emit(sponsorship, "Flagged")

                // check target got all their tokens back
                expect(await token.balanceOf(target.address)).to.equal(minimumStakeWei)
            })
        })
    })

    describe("UUPS upgradeability", () => {
        let upgraderRole: string
        let oldStreamrConfig: StreamrConfig
        let newStreamrConfigFactory: ContractFactory
        before(async () => {
            // this would be the upgraded version (e.g. StreamrConfigV2), and notAdmin would be attempting the upgrade
            const streamrConfigFactory = await getContractFactory("StreamrConfig", admin)
            oldStreamrConfig = await(await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })).deployed() as StreamrConfig
            newStreamrConfigFactory = await getContractFactory("StreamrConfigV1_1", notAdmin)
            upgraderRole = await oldStreamrConfig.UPGRADER_ROLE()
        })

        it("does NOT allow upgrade without UPGRADER_ROLE", async () => {
            await expect(upgrades.upgradeProxy(oldStreamrConfig.address, newStreamrConfigFactory))
                .to.be.revertedWith(`AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${upgraderRole.toLowerCase()}`)
        })

        it("does NOT allow calling initialize()", async () => {
            await expect(oldStreamrConfig.initialize())
                .to.be.revertedWith("Initializable: contract is already initialized")
        })

        it("storage is preserved after the upgrade", async () => {
            await (await oldStreamrConfig.grantRole(upgraderRole, notAdmin.address)).wait()
            const slashingFractionBeforeUpdate = await oldStreamrConfig.slashingFraction()

            await (await oldStreamrConfig.setSlashingFraction(parseEther("0.2"))).wait()

            const newStreamrConfigTx = await upgrades.upgradeProxy(oldStreamrConfig.address, newStreamrConfigFactory)
            const newStreamrConfig = await newStreamrConfigTx.deployed() as StreamrConfig

            expect(await newStreamrConfig.slashingFraction()).to.equal(parseEther("0.2"))

            // restore the modifications
            await (await oldStreamrConfig.setSlashingFraction(slashingFractionBeforeUpdate)).wait()
            await (await oldStreamrConfig.revokeRole(upgraderRole, notAdmin.address)).wait()
        })
    })

    describe("Limitations of config values", (): void => {
        // restore after these modifications
        after(async (): Promise<void> => {
            sharedConfig = await deployStreamrConfig(admin)
        })

        // test order may be important since they all use the same StreamrConfig instance: first test ones that depend on others
        it("flagStakeWei", async (): Promise<void> => {
            await expect(sharedConfig.setFlagStakeWei(parseEther("1")))
                .to.be.revertedWithCustomError(sharedConfig, "TooLow")
            await (await sharedConfig.setFlagStakeWei(parseEther("10000"))).wait()
        })
        it("flagReviewerSelectionIterations >= reviewerCount", async (): Promise<void> => {
            await expect(sharedConfig.setFlagReviewerSelectionIterations(4))
                .to.be.revertedWithCustomError(sharedConfig, "TooLow")
            await (await sharedConfig.setFlagReviewerSelectionIterations(7)).wait()
        })
        it("flagReviewerCount > 0", async (): Promise<void> => {
            await expect(sharedConfig.setFlagReviewerCount(0))
                .to.be.revertedWithCustomError(sharedConfig, "TooLow")
            await (await sharedConfig.setFlagReviewerCount(1)).wait()

            // setting flag reviewer count also bumps up iterations, otherwise we couldn't get so many reviewers
            await (await sharedConfig.setFlagReviewerCount(10)).wait()
            expect(await sharedConfig.flagReviewerSelectionIterations()).to.equal(10)
        })
        it("maxQueueSeconds >= maxPenaltyPeriodSeconds", async (): Promise<void> => {
            await expect(sharedConfig.setMaxQueueSeconds(3600 * 24 * 14))
                .to.be.revertedWithCustomError(sharedConfig, "TooLow")
            await (await sharedConfig.setMaxQueueSeconds(3600 * 24 * 14 + 1)).wait()
        })
        it("slashingFraction", async (): Promise<void> => {
            await expect(sharedConfig.setSlashingFraction("1000000000000000000"))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh")
            await (await sharedConfig.setSlashingFraction(parseEther("0.72"))).wait()
        })

        // ...then let the ones that don't depend on others change
        it("minimumSelfDelegationFraction <= 100%", async (): Promise<void> => {
            await expect(sharedConfig.setMinimumSelfDelegationFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh")
            await (await sharedConfig.setMinimumSelfDelegationFraction("1000000000000000000")).wait()
        })
        it("protocolFeeFraction <= 100%", async (): Promise<void> => {
            await expect(sharedConfig.setProtocolFeeFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh")
            await (await sharedConfig.setProtocolFeeFraction("1000000000000000000")).wait()
        })
        it("maxAllowedEarningsFraction <= 100%", async (): Promise<void> => {
            await expect(sharedConfig.setMaxAllowedEarningsFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh")
            await (await sharedConfig.setMaxAllowedEarningsFraction("1000000000000000000")).wait()
        })
        it("fishermanRewardFraction <= 100%", async (): Promise<void> => {
            await expect(sharedConfig.setFishermanRewardFraction("1000000000000000001"))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh")
            await (await sharedConfig.setFishermanRewardFraction("1000000000000000000")).wait()
        })
        it("minEligibleVoterFractionOfAllStake <= 100%", async (): Promise<void> => {
            await expect(sharedConfig.setMinEligibleVoterFractionOfAllStake(parseEther("2")))
                .to.be.revertedWithCustomError(sharedConfig, "TooHigh").withArgs("2000000000000000000", "1000000000000000000")
        })
    })

    describe("Access control", (): void => {
        it("only lets admin call setters", async (): Promise<void> => {
            const configuratorRole = await sharedConfig.CONFIGURATOR_ROLE()
            const expectedError = `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${configuratorRole.toLowerCase()}`
            await expect(sharedConfig.connect(notAdmin).setSponsorshipFactory(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setOperatorFactory(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setSlashingFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setOperatorContractOnlyJoinPolicy(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setStreamRegistryAddress(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMinimumDelegationWei("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMinimumSelfDelegationFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMaxPenaltyPeriodSeconds("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMaxAllowedEarningsFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFishermanRewardFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setProtocolFeeFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setProtocolFeeBeneficiary(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlagReviewerCount("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMaxQueueSeconds("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlagReviewerRewardWei("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlaggerRewardWei("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlagReviewerSelectionIterations("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlagStakeWei("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setReviewPeriodSeconds("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setVotingPeriodSeconds("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setFlagProtectionSeconds("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMinimumSelfDelegationFraction("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setRandomOracle(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setTrustedForwarder(admin.address)).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setEarlyLeaverPenaltyWei("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMinEligibleVoterAge("0")).to.be.revertedWith(expectedError)
            await expect(sharedConfig.connect(notAdmin).setMinEligibleVoterFractionOfAllStake("0")).to.be.revertedWith(expectedError)
        })

        it("prevents calling initialize", async (): Promise<void> => {
            await expect(sharedConfig.initialize())
                .to.be.revertedWith("Initializable: contract is already initialized")
            await expect(sharedConfig.connect(notAdmin).initialize())
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })
})
