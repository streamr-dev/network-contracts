import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import { advanceToTimestamp, getBlockTimestamp } from "./utils"
import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deploySponsorshipWithoutFactory } from "./deploySponsorshipContract"

import type { Sponsorship, IAllocationPolicy, IJoinPolicy, TestToken, IKickPolicy } from "../../../typechain"
import { Wallet } from "ethers"
import { getEIP2771MetaTx } from "../Registries/getEIP2771MetaTx"

const { defaultAbiCoder, parseEther, formatEther, hexZeroPad } = hardhatEthers.utils
const { getSigners, getContractFactory } = hardhatEthers

describe("Sponsorship contract", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet
    let op1: Wallet
    let op2: Wallet

    let token: TestToken

    let testKickPolicy: IKickPolicy
    let testJoinPolicy: IJoinPolicy
    let testAllocationPolicy: IAllocationPolicy

    let contracts: TestContracts

    // some test cases just want "any sponsorship", no need to deploy a new contract
    let defaultSponsorship: Sponsorship

    before(async (): Promise<void> => {
        [admin, operator, operator2, op1, op2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { sponsorshipFactory } = contracts
        testKickPolicy = await (await getContractFactory("TestKickPolicy", admin)).deploy() as IKickPolicy
        testAllocationPolicy = await (await getContractFactory("TestAllocationPolicy", admin)).deploy() as IAllocationPolicy
        testJoinPolicy = await (await (await getContractFactory("TestJoinPolicy", admin)).deploy()).deployed() as IJoinPolicy
        await (await sponsorshipFactory.addTrustedPolicies([testJoinPolicy.address, testAllocationPolicy.address])).wait()

        token = contracts.token
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(operator.address, parseEther("100000"))).wait()
        await (await token.transfer(operator2.address, parseEther("100000"))).wait()

        defaultSponsorship = await deploySponsorshipWithoutFactory(contracts)

        // revert to initial test values (using the real values would break the majority of tests)
        const { streamrConfig } = contracts
        await( await streamrConfig.setFlagReviewerRewardWei(parseEther("1"))).wait()
        await( await streamrConfig.setFlaggerRewardWei(parseEther("1"))).wait()
        await( await streamrConfig.setFlagReviewerCount(5)).wait()
    })

    it("if a bad operator contract reverts upon transferAndCall, he is kicked out of the sponsorship", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        const badOperator = await (await getContractFactory("TestBadOperator", admin)).deploy()
        await (await token.transfer(badOperator.address, parseEther("100"))).wait()
        await (await badOperator.stake(sponsorship.address, parseEther("100"), token.address)).wait()

        const sponsorshipBalanceBeforeUnstake = await token.balanceOf(sponsorship.address)
        const operatorBalanceBeforeUnstake = await token.balanceOf(badOperator.address)
        const sponsorshipStakeBeforeUnstake = await badOperator.getMyStake(sponsorship.address)
        await (await badOperator.unstake(sponsorship.address)).wait()
        const sponsorshipBalanceAfterUnstake = await token.balanceOf(sponsorship.address)
        const operatorBalanceAfterUnstake = await token.balanceOf(badOperator.address)
        const sponsorshipStakeAfterUnstake = await badOperator.getMyStake(sponsorship.address)
        
        expect(sponsorshipStakeBeforeUnstake).to.equal(parseEther("100"))
        expect(sponsorshipStakeAfterUnstake).to.equal(parseEther("0"))
        // TestBadOperator.onTokenTransfer reverts so the funds did not get transferred
        expect(operatorBalanceBeforeUnstake).to.equal(parseEther("0"))
        expect(operatorBalanceAfterUnstake).to.equal(parseEther("0"))
        expect(sponsorshipBalanceBeforeUnstake).to.equal(parseEther("100"))
        expect(sponsorshipBalanceAfterUnstake).to.equal(parseEther("100"))

        // bad operator got kicked out of the sponsorship even though he did not receive the funds from the previous unstake
        await expect(badOperator.unstake(sponsorship.address))
            .to.be.revertedWithCustomError(sponsorship, "OperatorNotStaked")
    })

    // longer happy path tests
    describe("Scenarios", (): void => {
        it("Multiple stakings and sponsorings", async function(): Promise<void> {
            // time since start 200...300...1000...1500...1600...2000  total
            // operator1 gets       50 + 400  + 400  +  80  + 400    = 1330
            // operator2 gets       50 + 100  + 100  +  20  +  0     =  270

            async function getBalances() {
                return [
                    formatEther(await token.balanceOf(sponsorship.address)),
                    formatEther(await token.balanceOf(op1.address)),
                    formatEther(await token.balanceOf(op2.address)),
                    formatEther(await sponsorship.getEarnings(op1.address)),
                    formatEther(await sponsorship.getEarnings(op2.address)),
                ]
            }

            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            const start = await getBlockTimestamp()

            advanceToTimestamp(start, "Stake to sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("1000"), op1.address)).wait()
            expect(await getBalances()).to.deep.equal(["1000.0", "0.0", "0.0", "0.0", "0.0"])

            advanceToTimestamp(start + 100, "Stake to sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("1000"), op2.address)).wait()
            expect(await getBalances()).to.deep.equal(["2000.0", "0.0", "0.0", "0.0", "0.0"])

            advanceToTimestamp(start + 200, "Sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("300"), "0x")).wait()
            await (await token.transferAndCall(sponsorship.address, parseEther("300"), "0x")).wait()
            expect(await getBalances()).to.deep.equal(["2600.0", "0.0", "0.0", "1.0", "1.0"]) // t = start + 202

            advanceToTimestamp(start + 300, "Stake more")
            await (await token.transferAndCall(sponsorship.address, parseEther("3000"), op1.address)).wait()
            expect(await getBalances()).to.deep.equal(["5600.0", "0.0", "0.0", "50.8", "50.2"]) // t = start + 301

            advanceToTimestamp(start + 1000, "Sponsorship top-up")
            await (await token.transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            expect(await getBalances()).to.deep.equal(["6600.0", "0.0", "0.0", "450.8", "150.2"]) // t = start + 1001

            advanceToTimestamp(start + 1499, "Withdraw") // for whatever reason withdraw goes to block +1
            await (await sponsorship.connect(op1).withdraw()).wait() // ...so here t = start + 1500
            expect(await getBalances()).to.deep.equal(["5750.0", "850.0", "0.0", "0.0", "250.0"]) //...and here also t = start + 1500 (?!)

            advanceToTimestamp(start + 1599, "Unstake") // same happens to unstake, +1
            await (await sponsorship.connect(op2).unstake()).wait()
            expect(await getBalances()).to.deep.equal(["4480.0", "850.0", "1270.0", "80.0", "0.0"])

            advanceToTimestamp(start + 2100, "Unstake") // here, sponsorship already has run out
            await (await sponsorship.connect(op1).unstake()).wait()
            expect(await getBalances()).to.deep.equal(["0.0", "5330.0", "1270.0", "0.0", "0.0"])
        })
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
                .to.be.revertedWithCustomError(defaultSponsorship, "MinimumStake")
        })

        it("will NOT let stake below minimum", async function(): Promise<void> {
            await expect(token.transferAndCall(defaultSponsorship.address, parseEther("0.5"), operator.address))
                .to.be.revertedWithCustomError(defaultSponsorship, "MinimumStake")
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
            await expect(admin.sendTransaction({to: defaultSponsorship.address})).to.be.revertedWithCustomError(defaultSponsorship, "AccessDenied")
        })

        it("will NOT let anyone stake using a wrong token", async function(): Promise<void> {
            const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())
            await (await newToken.mint(admin.address, parseEther("1000000"))).wait()
            await expect(newToken.transferAndCall(defaultSponsorship.address, parseEther("100"), admin.address))
                .to.be.revertedWithCustomError(defaultSponsorship, "OnlyDATAToken")
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
                .to.be.revertedWithCustomError(sponsorship, "MinimumStake")
        })

        it("won't let increase stake with reduceStakeTo", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).reduceStakeTo(parseEther("150")))
                .to.be.revertedWithCustomError(sponsorship, "CannotIncreaseStake")
        })

        it("won't let unstake if you would be slashed", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, { penaltyPeriodSeconds: 100 })
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).unstake())
                .to.be.revertedWithCustomError(sponsorship, "LeavePenalty")
        })

        it("won't let you reduceStake if you're not staked", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator).reduceStakeTo(0))
                .to.be.revertedWithCustomError(defaultSponsorship, "CannotIncreaseStake")
            await expect(defaultSponsorship.connect(operator).reduceStakeTo(parseEther("1")))
                .to.be.revertedWithCustomError(defaultSponsorship, "CannotIncreaseStake")
        })

        it("won't let you unstake if you're not staked", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator).unstake())
                .to.be.revertedWithCustomError(defaultSponsorship, "OperatorNotStaked")
        })

        it("lets you unstake when you unstake after the penalty period", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, { penaltyPeriodSeconds: 100 })
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await advanceToTimestamp((await getBlockTimestamp()) + 101, "Unstake after penalty period")
            await (await sponsorship.connect(operator).unstake()).wait()
        })

        it("lets you unstake (without being slashed) within penalty period if unfunded", async function(): Promise<void> {
            const start = await getBlockTimestamp()
            await advanceToTimestamp(start + 1, "Sponsorship")
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, { penaltyPeriodSeconds: 100 })
            await (await sponsorship.sponsor(parseEther("10"))).wait()
            await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await advanceToTimestamp(start + 20)
            await (await sponsorship.connect(operator).unstake()).wait()
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

        it("won't let you withdraw if you have no stake", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await sponsorship.sponsor(parseEther("10000"))).wait()
            const start = await getBlockTimestamp()

            // join tx actually happens at timeAtStart + 1
            await advanceToTimestamp(start, "Stake to sponsorship")
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

            await advanceToTimestamp(start + 101, "Withdraw from sponsorship")
            await (await sponsorship.connect(operator).unstake()).wait()
            await expect(sponsorship.connect(operator).withdraw())
                .to.be.revertedWithCustomError(defaultSponsorship, "OperatorNotStaked")
        })

        it("will let you withdraw 0 token if you have no earnings", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
            await expect(sponsorship.connect(operator).withdraw()).to.not.emit(sponsorship, "StakeUpdate")
        })

        it("shows zero allocation and zero stake after unstaking (no locked stake)", async function(): Promise<void> {
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

        it("forwards the reason when view call to policy reverts", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "9")
            await expect(sponsorship.solventUntilTimestamp())
                .to.be.revertedWith("test_getInsolvencyTimestamp")
        })

        it("throws ModuleGetError when view call to policy reverts without reason", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "10")
            await expect(sponsorship.solventUntilTimestamp())
                .to.be.revertedWithCustomError(sponsorship, "ModuleGetError")
        })
    })

    describe("Kicking/slashing", (): void => {
        it("can not slash more than you have staked", async function(): Promise<void> {
            const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], undefined, undefined, testKickPolicy)
            await expect(token.transferAndCall(sponsorship.address, parseEther("70"), operator.address))
                .to.emit(sponsorship, "OperatorJoined").withArgs(operator.address)

            // TestKickPolicy actually kicks and slashes given amount (here, 100)
            await expect(sponsorship.voteOnFlag(operator.address, hexZeroPad(parseEther("100").toHexString(), 32)))
                .to.emit(sponsorship, "OperatorSlashed").withArgs(operator.address, parseEther("70"))
        })
    })

    describe("Adding policies", (): void => {
        it("will FAIL for non-admins", async function(): Promise<void> {
            const { maxOperatorsJoinPolicy } = contracts
            const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
            await expect(defaultSponsorship.connect(operator).addJoinPolicy(maxOperatorsJoinPolicy.address, "2000000000000000000"))
                .to.be.revertedWith(`AccessControl: account ${operator.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`)
        })

        it("will fail if setting penalty period longer than 14 days", async function(): Promise<void> {
            const sponsorship = await (await getContractFactory("Sponsorship", { signer: admin })).deploy()
            await sponsorship.deployed()
            await sponsorship.initialize(
                "streamId",
                "metadata",
                contracts.streamrConfig.address,
                token.address,
                [
                    0,
                    1,
                    parseEther("1").toString()
                ],
                testAllocationPolicy.address,
            )

            await expect(sponsorship.setLeavePolicy(contracts.leavePolicy.address, 14 * 24 * 60 * 60 + 1))
                .to.be.revertedWith("error_penaltyPeriodTooLong")
        })
    })

    describe("Non-staked (non-)operator", (): void => {
        it("cannot unstake", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator2).unstake())
                .to.be.revertedWithCustomError(defaultSponsorship, "OperatorNotStaked")
        })
        it("cannot forceUnstake", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator2).forceUnstake())
                .to.be.revertedWithCustomError(defaultSponsorship, "OperatorNotStaked")
        })
        it("cannot reduceStakeTo", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator2).reduceStakeTo(parseEther("1")))
                .to.be.revertedWithCustomError(defaultSponsorship, "CannotIncreaseStake")
            await expect(defaultSponsorship.connect(operator2).reduceStakeTo(parseEther("0")))
                .to.be.revertedWithCustomError(defaultSponsorship, "CannotIncreaseStake")
        })
        it("cannot withdraw", async function(): Promise<void> {
            await expect(defaultSponsorship.connect(operator2).withdraw())
                .to.be.revertedWithCustomError(defaultSponsorship, "OperatorNotStaked")
        })
    })

    describe("Policy module interface", (): void => {
        it("only allows DEFAULT_ADMIN_ROLE to set policies", async function(): Promise<void> {
            await expect(defaultSponsorship.setAllocationPolicy(testAllocationPolicy.address, "0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(defaultSponsorship.setLeavePolicy(testAllocationPolicy.address, "0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(defaultSponsorship.setKickPolicy(testKickPolicy.address, "0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)
            await expect(defaultSponsorship.addJoinPolicy(testJoinPolicy.address, "0"))
                .to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/)

            // here we're really testing Initializable, but hey, full coverage is full coverage
            await expect(defaultSponsorship.initialize("", "", token.address, token.address, ["0", "0", "0"], testAllocationPolicy.address))
                .to.be.revertedWith("Initializable: contract is already initialized")
        })

        describe("IJoinPolicy negative tests", (): void => {
            it("error setting param on joinpolicy", async function(): Promise<void> {
                await expect(deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["1"])) // 1 => TestJoinPolicy:setParam will revert
                    .to.be.revertedWith("test-error: setting param join policy")
            })

            it("error setting param on joinpolicy no revert reason", async function(): Promise<void> {
                // 2 => TestJoinPolicy:setParam will revert without reason
                await expect(deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["2"]))
                    .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "ModuleCallError")
            })

            it("error joining on joinpolicy", async function(): Promise<void> {
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["0"])
                await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address)) // 100 ether => revert with reason
                    .to.be.revertedWith("test-error: onJoin join policy")
            })

            it("error joining on joinpolicy, empty error", async function(): Promise<void> {
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [testJoinPolicy], ["0"])
                await expect(token.transferAndCall(sponsorship.address, parseEther("200"), admin.address)) // 200 ether => revert without reason
                    .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "ModuleCallError")
            })
        })

        describe("IAllocationPolicy negative tests", (): void => {
            it("error setting param on allocationPolicy", async function(): Promise<void> {
                // 1 => will revert in setParam
                await expect(deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "1"))
                    .to.be.revertedWith("test_setParam")
            })

            it("error setting param on allocationPolicy, empty error", async function(): Promise<void> {
                // 2 => will revert without reason in setParam
                await expect(deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "2"))
                    .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "ModuleCallError")
            })

            it("error onJoin on allocationPolicy", async function(): Promise<void> {
                // 3 => onJoin will revert
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "3")
                await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                    .to.be.revertedWith("test_onJoin")
            })

            it("error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
                // 4 => onJoin will revert without reason
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "4")
                await expect(token.transferAndCall(sponsorship.address, parseEther("100"), admin.address))
                    .to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "ModuleCallError")
            })

            it("error onleave on allocationPolicy", async function(): Promise<void> {
                // 5 => onLeave will revert
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "5")
                await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
                await expect(sponsorship.connect(operator).unstake()).to.be.revertedWith("test_onLeave")
            })

            it("error onleave on allocationPolicy, empty error", async function(): Promise<void> {
                // 6 => onLeave will revert without reason
                const sponsorship = await deploySponsorshipWithoutFactory(contracts, {}, [], [], testAllocationPolicy, "6")
                await (await token.transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
                await expect(sponsorship.connect(operator).unstake()).to.be.revertedWithCustomError(contracts.sponsorshipTemplate, "ModuleCallError")
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
                    .to.be.revertedWithCustomError(sponsorship, "ModuleCallError")
            })
        })
    })

    describe("EIP-2771 meta-transactions via minimalforwarder", () => {
        it("can unstake on behalf of someone who doesn't hold any native tokens", async (): Promise<void> => {
            const signer = hardhatEthers.Wallet.createRandom().connect(admin.provider)

            const sponsorship = await deploySponsorshipWithoutFactory(contracts)
            await (await token.approve(sponsorship.address, parseEther("100"))).wait()
            await (await sponsorship.stake(signer.address, parseEther("100"))).wait()
            expect(await sponsorship.connect(signer).getMyStake()).to.be.equal(parseEther("100"))

            expect(await sponsorship.isTrustedForwarder(contracts.minimalForwarder.address)).to.be.true

            const data = await sponsorship.interface.encodeFunctionData("unstake")
            const { request, signature } = await getEIP2771MetaTx(sponsorship.address, data, contracts.minimalForwarder, signer)
            const signatureIsValid = await contracts.minimalForwarder.verify(request, signature)
            await expect(signatureIsValid).to.be.true
            await (await contracts.minimalForwarder.execute(request, signature)).wait()

            expect(await sponsorship.connect(signer.connect(admin.provider)).getMyStake()).to.be.equal(parseEther("0"))
            expect(await token.balanceOf(signer.address)).to.be.equal(parseEther("100"))
        })
    })
})
