import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { Contract, utils as ethersUtils, Wallet } from "ethers"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, TestToken } from "../../../typechain"

const { defaultAbiCoder, parseEther, formatEther } = ethersUtils
const { getSigners, getContractFactory } = hardhatEthers

import { advanceToTimestamp, getBlockTimestamp } from "./utils"

import {
    deployTestContracts,
    TestContracts,
} from "./deployTestContracts"

import { deploySponsorshipWithoutFactory } from "./deploySponsorshipContract"

describe("Sponsorship contract", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet

    let token: TestToken

    let testJoinPolicy: IJoinPolicy
    let testAllocationPolicy: IAllocationPolicy

    let contracts: TestContracts

    // some test cases just want "any sponsorship", no need to deploy a new contract
    let defaultSponsorship: Sponsorship

    before(async (): Promise<void> => {
        [admin, operator, operator2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        // TODO: fix type incompatibility, if at all possible
        const { sponsorshipFactory } = contracts
        testAllocationPolicy = await (await getContractFactory("TestAllocationPolicy", admin)).deploy() as unknown as IAllocationPolicy
        testJoinPolicy = await (await (await getContractFactory("TestJoinPolicy", admin)).deploy()).deployed() as unknown as IJoinPolicy
        await (await sponsorshipFactory.addTrustedPolicies([testJoinPolicy.address, testAllocationPolicy.address])).wait()

        token = contracts.token
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(operator.address, parseEther("100000"))).wait()
        await (await token.transfer(operator2.address, parseEther("100000"))).wait()

        defaultSponsorship = await deploySponsorshipWithoutFactory(contracts)
    })

    describe("Sponsoring", (): void => {
        it("will FAIL if sponsor called with no allowance", async function(): Promise<void> {
            expect(await token.allowance(operator.address, defaultSponsorship.address)).to.equal(0)
            await expect(defaultSponsorship.connect(operator).sponsor(parseEther("1"))).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
        })

        it("adds to remainingWei with just ERC20.transfer, after calling sponsor with zero", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.transfer(sponsorship.address, parseEther("100"))).wait()
            expect(await sponsorship.remainingWei()).to.equal(parseEther("0")) // ERC20 transfer doesn't call onTokenTransfer
            await expect(sponsorship.sponsor(parseEther("0")))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs(admin.address, "0")
                .to.emit(sponsorship, "SponsorshipReceived").withArgs("0x0000000000000000000000000000000000000000", parseEther("100"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(0, parseEther("100"), 0, false)
            expect(await sponsorship.remainingWei()).to.equal(parseEther("100"))
        })

        it("adds to remainingWei with just ERC20.transfer, after a second sponsoring", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.transfer(sponsorship.address, parseEther("100"))).wait()
            expect(await sponsorship.remainingWei()).to.equal(parseEther("0")) // ERC20 transfer doesn't call onTokenTransfer
            await (await token.approve(sponsorship.address, parseEther("100"))).wait()
            await expect(sponsorship.sponsor(parseEther("100")))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs(admin.address, parseEther("100"))
                .to.emit(sponsorship, "SponsorshipReceived").withArgs("0x0000000000000000000000000000000000000000", parseEther("100"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(0, parseEther("200"), 0, false)
            expect(await sponsorship.remainingWei()).to.equal(parseEther("200"))
        })

        it("works for top-up before old sponsorship runs out", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            const start = await getBlockTimestamp()

            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), "0x"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(0, parseEther("100"), 0, false)
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), "0x"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(0, parseEther("200"), 0, false)

            await advanceToTimestamp(start, "Stake to sponsorship")
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), operator.address))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("100"), parseEther("200"), 1, true)

            await advanceToTimestamp(start + 50, "Top-up sponsorship")
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), "0x"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("100"), parseEther("250"), 1, true)

            expect(await sponsorship.remainingWei()).to.equal(parseEther("250"))
        })

        it("works for top-up after old sponsorship runs out", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            const start = await getBlockTimestamp()

            await expect(token.transferAndCall(sponsorship.address, parseEther("200"), "0x"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(0, parseEther("200"), 0, false)

            await advanceToTimestamp(start, "Stake to sponsorship")
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), operator.address))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("100"), parseEther("200"), 1, true)

            await advanceToTimestamp(start + 300, "Top-up sponsorship")
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), "0x"))
                .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("100"), parseEther("100"), 1, true)
                .to.emit(sponsorship, "InsolvencyStarted").withArgs(start + 201) // the transactions happen at timestamp + 1
                .to.emit(sponsorship, "InsolvencyEnded").withArgs(start + 301, parseEther("1"), parseEther("100"))

            expect(await sponsorship.remainingWei()).to.equal(parseEther("100"))
        })
    })

    describe("Staking", (): void => {
        it("will NOT let stake zero", async function(): Promise<void> {
            await expect(token.transferAndCall(defaultSponsorship.address, parseEther("0"), operator.address))
                .to.be.revertedWith("error_minimumStake")
        })

        it("will NOT let stake below minimum", async function(): Promise<void> {
            await expect(token.transferAndCall(defaultSponsorship.address, parseEther("0.5"), operator.address))
                .to.be.revertedWith("error_minimumStake")
        })

        // tested separately because tests probably will mostly exercise the 1-step transferAndCall staking
        it("accepts 2-step staking: approve + stake", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.approve(sponsorship.address, parseEther("100"))).wait()
            await (await sponsorship.stake(operator.address, parseEther("100"))).wait()
            expect(await sponsorship.connect(operator).getMyStake()).to.be.equal(parseEther("100"))
        })

        // tested separately because tests probably will mostly exercise the non-padded address case
        it("accepts 32 byte long staker address in transferAndCall data", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            const addressPadded = defaultAbiCoder.encode(["address"], [operator.address])
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), addressPadded)).wait()
            expect(addressPadded.slice(0, 26)).to.equal("0x000000000000000000000000") // first 32 - 20 = 12 bytes are the padding
            expect(await sponsorship.connect(operator).getMyStake()).to.be.equal(parseEther("100"))
        })

        it("will NOT let anyone call the fallback function", async function(): Promise<void> {
            await expect(admin.sendTransaction({to: defaultSponsorship.address})).to.be.revertedWith("error_mustBeThis")
        })

        it("will NOT let anyone stake using a wrong token", async function(): Promise<void> {
            const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())
            await (await newToken.mint(admin.address, parseEther("1000000"))).wait()
            await expect(newToken.transferAndCall(defaultSponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWith("error_onlyDATAToken")
        })

        it("lets you add stake any small positive amount", async function(): Promise<void> {
            // ...as long of course as the minimum stake hasn't been changed in the meanwhile!
            // Adding stake won't take you below the minimum, which you already have since if you were staked.
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("0.1"), operator.address)).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, "1", operator.address)).wait()
        })

        // NOTE: minimum stake = 60 in StreamrConfig
        it("won't let reduce stake below minimum", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).reduceStakeTo(parseEther("50")))
                .to.be.revertedWith("error_minimumStake")
        })
    })

    describe("Querying", (): void => {
        it("shows zero allocation after a withdraw", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            const start = await getBlockTimestamp()

            // join tx actually happens at timeAtStart + 1
            await advanceToTimestamp(start, "Stake to sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

            await advanceToTimestamp(start + 101, "Withdraw from sponsorship")
            const allocationBeforeWithdraw = await sponsorship.getEarnings(operator.address)
            await (await sponsorship.connect(operator).withdraw()).wait()
            const allocationAfterWithdraw = await sponsorship.getEarnings(operator.address)

            expect(allocationBeforeWithdraw).to.equal(parseEther("100"))
            expect(allocationAfterWithdraw).to.equal(0)
        })

        it("shows zero allocation and zero stake after unstaking (no committed stake)", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            const start = await getBlockTimestamp()

            // join tx actually happens at timeAtStart + 1
            await advanceToTimestamp(start, "Stake to sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

            // queries will see start + 100 (off by one, NEXT tx will be start + 101)
            await advanceToTimestamp(start + 101, "Withdraw from sponsorship")
            const allocationBeforeUnstake = await sponsorship.getEarnings(operator.address)
            const stakeBeforeUnstake = await sponsorship.connect(operator).getMyStake()
            await (await sponsorship.connect(operator).unstake()).wait()
            const allocationAfterUnstake = await sponsorship.getEarnings(operator.address)
            const stakeAfterUnstake = await sponsorship.connect(operator).getMyStake()

            expect(formatEther(allocationBeforeUnstake)).to.equal("100.0")
            expect(formatEther(stakeBeforeUnstake)).to.equal("100.0")
            expect(allocationAfterUnstake).to.equal(0)
            expect(stakeAfterUnstake).to.equal(0)
        })
    })

    describe("Adding policies", (): void => {
        it("will FAIL for non-admins", async function(): Promise<void> {
            const { maxOperatorsJoinPolicy } = contracts
            const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
            await expect(defaultSponsorship.connect(operator).addJoinPolicy(maxOperatorsJoinPolicy.address, "2000000000000000000"))
                .to.be.revertedWith(`AccessControl: account ${operator.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`)
        })

        // TODO: is this a feature or a bug?
        it("silently fails when receives empty errors from policies", async function(): Promise<void> {
            const jpMS = await getContractFactory("TestAllocationPolicy", admin)
            const jpMSC = await jpMS.deploy() as Contract
            const testAllocPolicy = await jpMSC.connect(admin).deployed() as IAllocationPolicy
            await expect(defaultSponsorship.setAllocationPolicy(testAllocPolicy.address, "2"))
                .to.be.revertedWith("AccessControl: account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 is missing "
                + "role 0x0000000000000000000000000000000000000000000000000000000000000000")
        })
    })

    describe("Non-staked (non-)operator", (): void => {
        it("cannot unstake", async function(): Promise<void> {
            // TODO
        })
        it("cannot reduceStakeTo", async function(): Promise<void> {
            // TODO
        })
        it("cannot forceUnstake", async function(): Promise<void> {
            // TODO
        })
        it("cannot unstake", async function(): Promise<void> {
            // TODO
        })
        it("cannot flag/voteOnFlag", async function(): Promise<void> {
            // TODO
        })
    })

    describe("IJoinPolicy negative tests", (): void => {
        it("error setting param on joinpolicy", async function(): Promise<void> {
            await expect(deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["1"])) // 1 => TestJoinPolicy:setParam will revert
                .to.be.revertedWith("test-error: setting param join policy")
        })

        it("error setting param on joinpolicy no revert reason", async function(): Promise<void> {
            // 2 => TestJoinPolicy:setParam will revert without reason
            await expect(deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["2"]))
                .to.be.revertedWith("error_addJoinPolicyFailed")
        })

        it("error joining on joinpolicy", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["0"])
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address)) // 100 ether => revert with reason
                .to.be.revertedWith("test-error: onJoin join policy")
        })

        it("error joining on joinpolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["0"])
            await expect(token.transferAndCall(sponsorship.address, parseEther("200"), admin.address)) // 200 ether => revert without reason
                .to.be.revertedWith("error_joinPolicyOnJoin")
        })
    })

    describe("IAllocationPolicy negative tests", (): void => {
        it("error setting param on allocationPolicy", async function(): Promise<void> {
            await expect(deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "1")) // 1 => will revert in setParam
                .to.be.revertedWith("test_setParam")
        })

        it("error onJoin on allocationPolicy", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "3") // 3 => onJoin will revert
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWith("test_onJoin")
        })

        it("error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "4") // 4 => onJoin will revert without reason
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWith("error_allocationPolicyOnJoin")
        })

        it("error onleave on allocationPolicy", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "5") // 5 => onLeave will revert
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).unstake()).to.be.revertedWith("test_onLeave")
        })

        it("error onleave on allocationPolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "6") // 6 => onLeave will revert without reason
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).unstake()).to.be.revertedWith("error_leaveHandlerFailed")
        })

        it("error onStakeChange", async function(): Promise<void> {
            // 7 => onStakeChange will revert
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "7")
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), admin.address)).wait()
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWith("test_onStakeChange")
        })

        it("error onStakeChange, empty error", async function(): Promise<void> {
            // 8 => onStakeChange revert without reason
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "8")
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), admin.address)).wait()
            await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWith("error_stakeIncreaseFailed")
        })
    })
})
