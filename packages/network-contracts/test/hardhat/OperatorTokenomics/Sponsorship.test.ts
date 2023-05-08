import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { Contract, utils as ethersUtils, Wallet } from "ethers"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, TestToken } from "../../../typechain"

const { defaultAbiCoder, parseEther } = ethersUtils
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

        defaultSponsorship = await deploySponsorshipWithoutFactory(contracts, {
            minimumStakeWei: parseEther("1"),
        })
    })

    it("accepts 32 byte long address in transferAndCall data", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await token.transferAndCall(sponsorship.address, parseEther("1"), defaultAbiCoder.encode(["address"], [operator.address]))).wait()
        expect(await sponsorship.connect(operator).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("accepts 2-step staking: approve + stake", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await token.approve(sponsorship.address, parseEther("1"))).wait()
        await (await sponsorship.stake(operator.address, parseEther("1"))).wait()
        expect(await sponsorship.connect(operator).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("will NOT let anyone call the fallback function", async function(): Promise<void> {
        await expect(admin.sendTransaction({to: defaultSponsorship.address})).to.be.revertedWith("error_mustBeThis")
    })

    it("will NOT let anyone join with wrong token", async function(): Promise<void> {
        const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())
        await (await newToken.mint(admin.address, parseEther("1000000"))).wait()
        await expect(newToken.transferAndCall(defaultSponsorship.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_onlyDATAToken")
    })

    describe("Sponsoring", (): void => {
        it("will FAIL if sponsor called with no allowance", async function(): Promise<void> {
            expect(await token.allowance(operator.address, defaultSponsorship.address)).to.equal(0)
            await expect(defaultSponsorship.connect(operator).sponsor(parseEther("1"))).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
        })

        it("adds to unallocatedWei even with ERC20.transfer, after calling sponsor with zero", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.transfer(sponsorship.address, parseEther("1"))).wait()
            expect(await sponsorship.unallocatedWei()).to.equal(parseEther("0")) // ERC20 transfer doesn't call onTokenTransfer
            await (await sponsorship.sponsor(parseEther("0"))).wait()
            expect(await sponsorship.unallocatedWei()).to.equal(parseEther("1"))
        })

        it("adds to unallocatedWei even with ERC20.transfer, after a second sponsoring", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.transfer(sponsorship.address, parseEther("1"))).wait()
            expect(await sponsorship.unallocatedWei()).to.equal(parseEther("0")) // ERC20 transfer doesn't call onTokenTransfer
            await (await token.approve(sponsorship.address, parseEther("1"))).wait()
            await (await sponsorship.sponsor(parseEther("1"))).wait()
            expect(await sponsorship.unallocatedWei()).to.equal(parseEther("2"))
        })
    })

    it("will NOT let stake zero", async function(): Promise<void> {
        await expect(token.transferAndCall(defaultSponsorship.address, parseEther("0"), operator.address))
            .to.be.revertedWith("error_minimumStake")
    })

    it("will NOT let stake below minimum", async function(): Promise<void> {
        await expect(token.transferAndCall(defaultSponsorship.address, parseEther("0.5"), operator.address))
            .to.be.revertedWith("error_minimumStake")
    })

    it("won't let reduce stake below minimum", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, { minimumStakeWei: parseEther("10") })
        await (await sponsorship.sponsor(parseEther("10000"))).wait()
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("20"), operator.address)).wait()
        await expect(sponsorship.connect(operator).reduceStakeTo(parseEther("5")))
            .to.be.revertedWith("error_minimumStake")
    })

    it("shows zero allocation after a withdraw", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const start = await getBlockTimestamp()

        // join tx actually happens at timeAtStart + 1
        await advanceToTimestamp(start, "Stake to sponsorship")
        await (await token.transferAndCall(sponsorship.address, parseEther("10"), operator.address)).wait()

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
        await (await token.transferAndCall(sponsorship.address, parseEther("10"), operator.address)).wait()

        await advanceToTimestamp(start + 101, "Withdraw from sponsorship") // queries will see start + 100 (off by one, NEXT tx will be start + 101)
        const allocationBeforeUnstake = await sponsorship.getEarnings(operator.address)
        const stakeBeforeUnstake = await sponsorship.connect(operator).getMyStake()
        await (await sponsorship.connect(operator).unstake()).wait()
        const allocationAfterUnstake = await sponsorship.getEarnings(operator.address)
        const stakeAfterUnstake = await sponsorship.connect(operator).getMyStake()

        expect(allocationBeforeUnstake).to.equal(parseEther("100"))
        expect(stakeBeforeUnstake).to.equal(parseEther("10"))
        expect(allocationAfterUnstake).to.equal(0)
        expect(stakeAfterUnstake).to.equal(0)
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
            await expect(token.transferAndCall(sponsorship.address, 1, admin.address))
                .to.be.revertedWith("test-error: onJoin join policy")
        })

        it("error joining on joinpolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["0"])
            await expect(token.transferAndCall(sponsorship.address, 2, admin.address))
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
            await expect(token.transferAndCall(sponsorship.address, parseEther("1"), admin.address))
                .to.be.revertedWith("test_onJoin")
        })

        it("error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "4") // 4 => onJoin will revert without reason
            await expect(token.transferAndCall(sponsorship.address, parseEther("1"), admin.address))
                .to.be.revertedWith("error_allocationPolicyOnJoin")
        })

        it("error onleave on allocationPolicy", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "5") // 5 => onLeave will revert
            await (await token.transferAndCall(sponsorship.address, parseEther("1"), operator.address)).wait()
            await expect(sponsorship.connect(operator).unstake()).to.be.revertedWith("test_onLeave")
        })

        it("error onleave on allocationPolicy, empty error", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {},
                [], [], testAllocationPolicy, "6") // 6 => onLeave will revert without reason
            await (await token.transferAndCall(sponsorship.address, parseEther("1"), operator.address)).wait()
            await expect(sponsorship.connect(operator).unstake()).to.be.revertedWith("error_leaveHandlerFailed")
        })

        it("error onStakeChange", async function(): Promise<void> {
            // 7 => onStakeChange will revert
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "7")
            await (await token.transferAndCall(sponsorship.address, parseEther("1"), admin.address)).wait()
            await expect(token.transferAndCall(sponsorship.address, parseEther("1"), admin.address))
                .to.be.revertedWith("test_onStakeChange")
        })

        it("error onStakeChange, empty error", async function(): Promise<void> {
            // 8 => onStakeChange revert without reason
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "8")
            await (await token.transferAndCall(sponsorship.address, parseEther("1"), admin.address)).wait()
            await expect(token.transferAndCall(sponsorship.address, parseEther("1"), admin.address))
                .to.be.revertedWith("error_stakeIncreaseFailed")
        })
    })
})
