import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { deployOperatorFactory, deployTestContracts, TestContracts } from "./deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp, VOTE_KICK, VOTE_START } from "./utils"
import { deployOperatorContract } from "./deployOperatorContract"

import { deploySponsorship } from "./deploySponsorshipContract"
import { IKickPolicy } from "../../../typechain"
import { setupSponsorships } from "./setupSponsorships"

const { parseEther, formatEther, hexZeroPad } = utils
const { getSigners, getContractFactory } = hardhatEthers

describe("Operator contract", (): void => {
    let admin: Wallet           // creates the Sponsorship
    let sponsor: Wallet         // sponsors the Sponsorship
    let operatorWallet: Wallet  // creates Operator contract
    let operator2Wallet: Wallet // second Operator that does triggerAnotherOperatorWithdraw to earn rewards
    let delegator: Wallet       // puts DATA into Operator contract
    let delegator2: Wallet
    let delegator3: Wallet
    let controller: Wallet      // acts on behalf of operatorWallet
    let protocolFeeBeneficiary: Wallet

    // many tests don't need their own clean set of contracts that take time to deploy
    let sharedContracts: TestContracts
    let testKickPolicy: IKickPolicy

    // burn all tokens then mint the corrent amount of new ones
    async function setTokens(account: Wallet, amount: string) {
        const { token } = sharedContracts
        const oldBalance = await token.balanceOf(account.address)
        await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
        if (amount !== "0") {
            await (await token.mint(account.address, parseEther(amount))).wait()
        }
    }

    async function deployOperator(deployer: Wallet, opts?: any) {
        // we want to re-deploy the OperatorFactory (not all the policies or SponsorshipFactory)
        // so that same operatorWallet can create a clean contract (OperatorFactory prevents several contracts from same deployer)
        const newContracts = {
            ...sharedContracts,
            ...await deployOperatorFactory(sharedContracts, deployer)
        }

        const operatorsCutFraction = parseEther("1").mul(opts?.operatorsCutPercent ?? 0).div(100)
        return deployOperatorContract(newContracts, deployer, operatorsCutFraction)
    }

    // fix up after deployOperator->deployOperatorFactory messes up the OperatorFactory address of the sharedContracts.streamrConfig
    afterEach(async function(): Promise<void> {
        await (await sharedContracts.streamrConfig!.setOperatorFactory(sharedContracts.operatorFactory.address)).wait()
        await (await sharedContracts.streamrConfig!.setMinimumSelfDelegationFraction("0")).wait()
    })

    before(async (): Promise<void> => {
        [
            admin, sponsor, operatorWallet, operator2Wallet, delegator, delegator2, delegator3, controller, protocolFeeBeneficiary
        ] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)

        testKickPolicy = await (await (await getContractFactory("TestKickPolicy", admin)).deploy()).deployed() as unknown as IKickPolicy
        await (await sharedContracts.sponsorshipFactory.addTrustedPolicies([ testKickPolicy.address])).wait()

        await (await sharedContracts.streamrConfig.setMinimumSelfDelegationFraction("0")).wait()
        await (await sharedContracts.streamrConfig.setProtocolFeeBeneficiary(protocolFeeBeneficiary.address)).wait()
    })

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it("revenue sharing scenarios 1..6: happy path operator life cycle", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts

        // Setup:
        // - There is one single delegator with funds of 1000 DATA and no delegations.
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "2000")
        await setTokens(operatorWallet, "0")
        const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 }) // policy needed in part 4
        const timeAtStart = await getBlockTimestamp()

        // 1: Simple Join/Delegate
        // "There is a maximum allocation policy of 500 DATA in this system." not implemented => simulate by only delegating 5 DATA
        await advanceToTimestamp(timeAtStart, "Delegate")
        await (await dataToken.connect(delegator).transferAndCall(operator.address, parseEther("500"), "0x")).wait()

        // delegator sent 500 DATA to operator contract => both have 500 DATA
        expect(await operator.balanceInData(delegator.address)).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("500"))
        expect(await operator.totalSupply()).to.equal(parseEther("500"))

        // Setup for 2: sponsorship must be only 25 so at #6, Unstaked returns earnings=0
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(sponsorship.address, parseEther("2000"), "0x")).wait()

        expect(formatEther(await dataToken.balanceOf(sponsor.address))).to.equal("0.0")
        expect(formatEther(await dataToken.balanceOf(sponsorship.address))).to.equal("2000.0")

        // 2: Simple Staking
        await advanceToTimestamp(timeAtStart + 1000, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("500")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(sponsorship.address)).to.equal(parseEther("2500")) // 2000 sponsorship + 500 stake
        expect(await sponsorship.stakedWei(operator.address)).to.equal(parseEther("500"))
        expect(await sponsorship.getEarnings(operator.address)).to.equal(parseEther("0"))

        // 3: Yield Allocated to Accounts
        // Skip this: there is no "yield allocation policy" that sends incoming earnings directly to delegators

        // 4: Yield Allocated to Operator value
        // Sponsorship only had 2000 DATA unallocated, so that's what it will allocate
        // Operator withdraws the 2000 DATA, but
        //   protocol fee is 5% = 2000 * 0.05 = 100 => 2000 - 100 = 1900 DATA left
        //   the operator's cut 20% = 1900 * 0.2 = 380 DATA is added to self-delegation
        // Profit is 2000 - 100 - 380 = 1520 DATA
        await advanceToTimestamp(timeAtStart + 10000, "Withdraw from sponsorship")
        await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
            .to.emit(operator, "Profit").withArgs(parseEther("1520"), parseEther("380"), parseEther("100"))

        // total value = DATA balance + stake(s) in sponsorship(s) + earnings in sponsorship(s) = 1900 + 500 + 0 = 2400 DATA
        expect(formatEther(await dataToken.balanceOf(operator.address))).to.equal("1900.0")
        expect(formatEther(await operator.balanceOf(delegator.address))).to.equal("500.0")
        expect(formatEther(await dataToken.balanceOf(delegator.address))).to.equal("500.0")
        expect(formatEther(await dataToken.balanceOf(protocolFeeBeneficiary.address))).to.equal("100.0")

        // 5: Withdraw/Undelegate
        // Because the contract's balance is at 1900 DATA, that is the amount of DATA which will be paid out. Remaining amount remains in the queue.
        await expect(operator.connect(delegator).undelegate(parseEther("2000")))
            .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("2000"), 0)
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("1900"))
            .to.emit(operator, "QueueUpdated").withArgs(delegator.address, parseEther("100"), 0)

        expect(formatEther(await dataToken.balanceOf(operator.address))).to.equal("0.0") // all sent out
        expect(formatEther(await dataToken.balanceOf(delegator.address))).to.equal("2400.0")

        // 6: Pay out the queue by unstaking
        await expect(operator.unstake(sponsorship.address))
            .to.emit(operator, "Unstaked").withArgs(sponsorship.address)

        expect(formatEther(await dataToken.balanceOf(delegator.address))).to.equal("2500.0")

        expect(await operator.queueIsEmpty()).to.equal(true)
    })

    describe("Delegator functionality", (): void => {
        it("allows delegate and undelegate", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            const operator = await deployOperator(operatorWallet)
            await (await token.connect(delegator).approve(operator.address, parseEther("1000"))).wait()
            await expect(operator.connect(delegator).delegate(parseEther("1000")))
                .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("1000"))
            const contractBalanceAfterDelegate = await token.balanceOf(operator.address)

            await expect(operator.connect(delegator).undelegate(parseEther("1000")))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("1000"))
            const contractBalanceAfterUndelegate = await token.balanceOf(operator.address)

            expect(formatEther(contractBalanceAfterDelegate)).to.equal("1000.0")
            expect(formatEther(contractBalanceAfterUndelegate)).to.equal("0.0")
        })

        it("allows delegate, transfer of operatorTokens, and undelegate by another delegator", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            const operator = await deployOperator(operatorWallet)
            await (await token.connect(delegator).approve(operator.address, parseEther("1000"))).wait()
            await expect(operator.connect(delegator).delegate(parseEther("1000")))
                .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("1000"))
            const contractBalanceAfterDelegate = await token.balanceOf(operator.address)

            await (await operator.connect(delegator).transfer(delegator2.address, parseEther("1000"))).wait()

            await expect(operator.connect(delegator2).undelegate(parseEther("1000")))
                .to.emit(operator, "Undelegated").withArgs(delegator2.address, parseEther("1000"))
            const contractBalanceAfterUndelegate = await token.balanceOf(operator.address)

            expect(formatEther(contractBalanceAfterDelegate)).to.equal("1000.0")
            expect(formatEther(contractBalanceAfterUndelegate)).to.equal("0.0")
        })
    })

    describe("Stake management", (): void => {
        it("stakes, and unstakes with gains", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")
            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const balanceBefore = await token.balanceOf(operator.address)
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            await advanceToTimestamp(timeAtStart + 1000, "Unstake from sponsorship")
            await expect(operator.unstake(sponsorship.address))
                .to.emit(operator, "Unstaked").withArgs(sponsorship.address)
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))

            const gains = (await token.balanceOf(operator.address)).sub(balanceBefore)
            expect(formatEther(gains)).to.equal("950.0") // 190 operator fee was automatically re-delegated (it never left the contract)
        })

        it("stakes, then stakes more", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "2000")
            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("2000"), "0x")).wait()

            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("1000"))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            await expect(operator.stake(sponsorship.address, parseEther("500")))
                .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("1500"))
                .to.not.emit(operator, "Staked")

            await expect(operator.stake(sponsorship.address, parseEther("500")))
                .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("2000"))
                .to.not.emit(operator, "Staked")
        })
    })

    describe("Withdrawing and profit sharing", () => {

        // Corresponds to a test in network repo / broker subsystem / operator plugin:
        // https://github.com/streamr-dev/network/blob/streamr-1.0/packages/broker/test/integration/plugins/operator/maintainOperatorValue.test.ts
        it("can withdraw from sponsorship (happy path)", async function(): Promise<void> {
            const STAKE_AMOUNT = "100"
            const STAKE_AMOUNT_WEI = parseEther(STAKE_AMOUNT)
            const operatorsCutFraction = parseEther("0.1") // 10%
            const triggerWithdrawLimitSeconds = 50

            const { token } = sharedContracts

            // "generateWalletWithGasAndTokens", fund a fresh random wallet
            const operatorWallet = Wallet.createRandom().connect(admin.provider)
            admin.sendTransaction({ to: operatorWallet.address, value: parseEther("5000") }) // coverage test requires this amount of ETH
            await setTokens(operatorWallet, STAKE_AMOUNT)

            await setTokens(sponsor, "250")
            const operatorContract = await deployOperatorContract(sharedContracts, operatorWallet, operatorsCutFraction)
            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("250"), "0x")).wait()
            await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, STAKE_AMOUNT_WEI, "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await (await operatorContract.stake(sponsorship.address, STAKE_AMOUNT_WEI)).wait()

            await advanceToTimestamp(timeAtStart + 1 + triggerWithdrawLimitSeconds, "Withdraw")
            const earningsBeforeWithdraw = (await operatorContract.getSponsorshipsAndEarnings()).earnings[0]
            const valueBeforeWithdraw = await operatorContract.valueWithoutEarnings()
            await (await operatorContract.withdrawEarningsFromSponsorships([sponsorship.address])).wait()
            const earningsAfterWithdraw = (await operatorContract.getSponsorshipsAndEarnings()).earnings[0]
            const valueAfterWithdraw = await operatorContract.valueWithoutEarnings()

            expect(valueAfterWithdraw).to.be.greaterThan(valueBeforeWithdraw)
            expect(earningsBeforeWithdraw).to.equal(parseEther("1").mul(triggerWithdrawLimitSeconds))
            expect(earningsAfterWithdraw).to.equal(0)
        })

        it("withdraws sponsorships earnings when withdrawEarningsFromSponsorships is called", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(sponsor, "1000")
            await setTokens(operatorWallet, "1000")
            const operator = await deployOperator(operatorWallet)
            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await (await operator.stake(sponsorship.address, parseEther("1000"))).wait()

            // some time passes => valueWithoutEarnings differs from real operator value
            await advanceToTimestamp(timeAtStart + 1001, "Read the earnings back to Operator")

            const valueBefore = await operator.valueWithoutEarnings()
            const sponsorshipsBefore = await operator.getSponsorshipsAndEarnings()
            const totalStakedIntoSponsorshipsWeiBefore = await operator.totalStakedIntoSponsorshipsWei()

            await (await operator.withdrawEarningsFromSponsorships([sponsorship.address])).wait()

            // value after == totalStakedIntoSponsorshipsWei + Operator's DATA balance
            const valueAfter = await operator.valueWithoutEarnings()
            const sponsorshipsAfter = await operator.getSponsorshipsAndEarnings()
            const totalStakedIntoSponsorshipsWeiAfter = await operator.totalStakedIntoSponsorshipsWei()

            expect(formatEther(valueBefore)).to.equal("1000.0")
            expect(formatEther(sponsorshipsBefore.earnings[0])).to.equal("1000.0")
            expect(sponsorshipsBefore.addresses[0]).to.equal(sponsorship.address)
            expect(formatEther(totalStakedIntoSponsorshipsWeiBefore)).to.equal("1000.0")

            expect(formatEther(valueAfter)).to.equal("1950.0")
            expect(formatEther(sponsorshipsAfter.earnings[0])).to.equal("0.0") // it's zero because we withdrew all earnings
            expect(sponsorshipsAfter.addresses[0]).to.equal(sponsorship.address)
            expect(formatEther(totalStakedIntoSponsorshipsWeiAfter)).to.equal("1000.0") // doesn't include DATA in Operator, or earnings => no change
        })

        it("self-delegates all of operator's cut during withdraw", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(sponsor, "1000")
            await setTokens(operatorWallet, "1000")
            await setTokens(delegator, "1000")
            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1000.0")

            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })

            expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("100"), "0x")).wait()

            expect(formatEther(await token.balanceOf(operatorWallet.address))).to.equal("900.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("100.0")
            expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal("100.0")

            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("900"), "0x")).wait()

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("100.0") // 1000 - 900
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("1000.0") // 100 + 900
            expect(formatEther(await operator.balanceOf(delegator.address))).to.equal("900.0")

            const timeAtStart = await getBlockTimestamp()

            // operator staked 100 DATA so they should have 100 Operator tokens
            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("2000.0") // 1000 + 1000
            expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal("100.0")

            await advanceToTimestamp(timeAtStart + 500, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("380"), parseEther("95"), parseEther("25"))

            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1500.0") // 2000 - 500
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("475.0") // only protocol fee of 25 left the contract
            expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal("168.840579710144927536") // TODO: find nice numbers!
        })

        it("pays part of operator's cut from withdraw to caller (fisherman) if too much earnings", async function(): Promise<void> {
            // deploy two operators using deployOperatorContract.
            // It's important they come from same factory, hence can't use deployOperator helper as-is
            const contracts = {
                ...sharedContracts,
                ...await deployOperatorFactory(sharedContracts, admin)
            }
            const operator1 = await deployOperatorContract(contracts, operatorWallet, parseEther("0.4"))
            const operator2 = await deployOperatorContract(contracts, operator2Wallet, parseEther("0.123")) // doesn't affect calculations
            const sponsorship1 = await deploySponsorship(contracts)
            const sponsorship2 = await deploySponsorship(contracts)

            const { token } = sharedContracts
            await setTokens(operatorWallet, "1000")
            await setTokens(operator2Wallet, "1000")
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "2000")

            await (await token.connect(operatorWallet).transferAndCall(operator1.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator1.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(operator2Wallet).transferAndCall(operator2.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship1.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship2.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()
            await advanceToTimestamp(timeAtStart, "Stake to sponsorship 1")
            await expect(operator1.stake(sponsorship1.address, parseEther("1000")))
                .to.emit(operator1, "Staked").withArgs(sponsorship1.address)

            await advanceToTimestamp(timeAtStart + 10, "Stake to sponsorship 2")
            await expect(operator1.stake(sponsorship2.address, parseEther("1000")))
                .to.emit(operator1, "Staked").withArgs(sponsorship2.address)

            // total earnings are 10 < 100 == 5% of 2000 (pool value), so triggerAnotherOperatorWithdraw should fail
            const sponsorshipsBefore = await operator1.getSponsorshipsAndEarnings()
            expect(sponsorshipsBefore.addresses).to.deep.equal([sponsorship1.address, sponsorship2.address])
            expect(sponsorshipsBefore.earnings.map(formatEther)).to.deep.equal(["10.0", "0.0"])
            expect(formatEther(sponsorshipsBefore.maxAllowedEarnings)).to.equal("100.0")
            expect(sponsorshipsBefore.earnings[0].add(sponsorshipsBefore.earnings[1])).to.be.lessThan(sponsorshipsBefore.maxAllowedEarnings)
            await expect(operator2.triggerAnotherOperatorWithdraw(operator1.address, [sponsorship1.address, sponsorship2.address]))
                .to.be.revertedWithCustomError(operator2, "DidNotReceiveReward")

            // wait until all sponsorings are allocated => there is now 1000+1000 new earnings in the two Sponsorships where operator1 is staked
            await advanceToTimestamp(timeAtStart + 5000, "Force withdraw earnings from Sponsorships")
            expect(await operator1.valueWithoutEarnings()).to.equal(parseEther("2000"))  // stakes only
            expect(await token.balanceOf(operator1.address)).to.equal(parseEther("0"))
            expect(await operator1.balanceOf(operatorWallet.address)).to.equal(parseEther("1000")) // operator's self-delegation
            expect(await operator1.balanceOf(delegator.address)).to.equal(parseEther("1000"))

            // operator2 hasn't staked anywhere, so all value is in the contract's DATA balance
            expect(await token.balanceOf(operator2.address)).to.equal(parseEther("1000"))
            expect(await operator2.valueWithoutEarnings()).to.equal(parseEther("1000"))

            // earnings are 2000 > 100 == 5% of 2000 (pool value), so triggerAnotherOperatorWithdraw should work
            const sponsorshipsAfter = await operator1.getSponsorshipsAndEarnings()
            expect(sponsorshipsAfter.addresses).to.deep.equal([sponsorship1.address, sponsorship2.address])
            expect(sponsorshipsAfter.earnings.map(formatEther)).to.deep.equal(["1000.0", "1000.0"])
            expect(formatEther(sponsorshipsAfter.maxAllowedEarnings)).to.equal("100.0")
            expect(sponsorshipsAfter.earnings[0].add(sponsorshipsAfter.earnings[1])).to.be.greaterThan(sponsorshipsAfter.maxAllowedEarnings)

            // withdraw will be 2000
            //  protocol fee 5% = 100
            //  operator's cut 40% of the remaining 1900 = 760
            //  the remaining 1900 - 760 = 1140 will be shared among delegators (Profit)
            //  reward will be 50% of the operator's cut = 380
            //  the remaining 50% of the operator's cut = 380 will be added to operator1's self-delegation
            // operator1's pool value increased by 1900 (earnings after protocol fee) - 380 (reward) = 1520
            await expect(operator2.triggerAnotherOperatorWithdraw(operator1.address, [sponsorship1.address, sponsorship2.address]))
                .to.emit(operator1, "Profit").withArgs(parseEther("1140"), parseEther("380"), parseEther("100"))
                .to.emit(operator1, "OperatorValueUpdate").withArgs(parseEther("2000"), parseEther("1520"))
                .to.emit(operator2, "OperatorValueUpdate").withArgs(0, parseEther("1380")) // 0 == not staked anywhere

            // operator1 pool value after profit is 2000 + 1140 = 3140 => exchange rate for operator's cut is 3140 / 2000 = 1.57 DATA / operator token
            // operator2 pool value was 1000 DATA => exchange rate for operator's reward is 1000 / 1000 = 1 DATA / operator token
            expect(await operator1.valueWithoutEarnings()).to.equal(parseEther("3520"))
            expect(await operator2.valueWithoutEarnings()).to.equal(parseEther("1380"))

            // operator1's 380 DATA was added to operator1 pool value as self-delegation (not Profit)
            //  => operatorWallet1 received 380 / 1.57 ~= 242.03 operator tokens, in addition to the 1000 from the initial self-delegation
            // operator2's 380 DATA was added to operator2 pool value as self-delegation, exchange rate was still 1 DATA / operator token
            //  => operatorWallet2 received 380 / 1 = 380 operator tokens, in addition to the 1000 operator tokens from the initial self-delegation
            expect(await operator1.balanceOf(operatorWallet.address)).to.equal("1242038216560509554140") // TODO: find nicer numbers!
            expect(await operator2.balanceOf(operator2Wallet.address)).to.equal(parseEther("1380"))

            // (other) delegators' balances are unchanged
            expect(await operator1.balanceOf(delegator.address)).to.equal(parseEther("1000"))
        })

        it("can update operator cut fraction for himself, but NOT for others", async function(): Promise<void> {
            const operator = await deployOperator(operatorWallet)
            const operator2 = await deployOperator(operator2Wallet)

            await expect(operator.updateOperatorsCutFraction(parseEther("0.2")))
                .to.emit(operator, "MetadataUpdated").withArgs(await operator.metadata(), operatorWallet.address, parseEther("0.2"))
            await expect(operator2.connect(operatorWallet).updateOperatorsCutFraction(parseEther("0.2")))
                .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")
        })

        it("can NOT update the operator cut fraction if it's staked in any sponsorships", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            const operator = await deployOperator(operatorWallet)
            const sponsorship = await deploySponsorship(sharedContracts)
            const sponsorship2 = await deploySponsorship(sharedContracts)
            await (await token.connect(delegator).approve(operator.address, parseEther("1000"))).wait()
            await (await operator.connect(delegator).delegate(parseEther("1000"))).wait()

            // can update the operator cut fraction before staking
            await expect(operator.updateOperatorsCutFraction(parseEther("0.2")))
                .to.emit(operator, "MetadataUpdated").withArgs(await operator.metadata(), operatorWallet.address, parseEther("0.2"))

            // can't update the operator cut fraction after staking
            await (await operator.stake(sponsorship.address, parseEther("500"))).wait()
            await (await operator.stake(sponsorship2.address, parseEther("500"))).wait()
            await expect(operator.updateOperatorsCutFraction(parseEther("0.2")))
                .to.be.revertedWithCustomError(operator, "StakedInSponsorships")

            // must unstake from all sponsorships before updating the operator cut fraction
            await (await operator.unstake(sponsorship.address)).wait() // unstake only from one sponsorship, not both
            await expect(operator.updateOperatorsCutFraction(parseEther("0.3")))
                .to.be.revertedWithCustomError(operator, "StakedInSponsorships")

            // can update the operator cut fraction after unstaking from ALL sponsorships
            await (await operator.unstake(sponsorship2.address)).wait()
            await expect(operator.updateOperatorsCutFraction(parseEther("0.3")))
                .to.emit(operator, "MetadataUpdated").withArgs(await operator.metadata(), operatorWallet.address, parseEther("0.3"))
        })

        it("will deduct slashing from the operator's cut", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(operatorWallet, "1000")
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "3000")

            // this test is set up to easily compare two sponsorships: get slashed in the first one, unstake normally from the second one
            // sponsor the 1st sponsorship more to keep it running, so that operator can be slashed for leaving while it's running
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            const sponsorship = await deploySponsorship(sharedContracts, { penaltyPeriodSeconds: 2000 }) // > 1000 so slashing will happen
            const sponsorship2 = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("2000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship2.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorships")
            await (await operator.stake(sponsorship.address, parseEther("1000"))).wait()
            await (await operator.stake(sponsorship2.address, parseEther("1000"))).wait()

            await advanceToTimestamp(timeAtStart + 900, "Check that unstaking would give correct penalty")
            await expect(operator.unstake(sponsorship.address))
                .to.be.revertedWithCustomError(sponsorship, "LeavePenalty").withArgs(parseEther("100")) // 10% of the 1000 DATA stake

            // notice: all of 100 DATA slashing is taken from the operator's cut
            await advanceToTimestamp(timeAtStart + 1000, "Unstake from sponsorships")
            await expect(operator.forceUnstake(sponsorship.address, 0))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("90"), parseEther("50"))
            await expect(operator.unstake(sponsorship2.address))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
        })

        it("will take all of operator's cut if cut isn't enough to cover slashed stake", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(operatorWallet, "1000")
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "3000")

            // this test is set up to easily compare two sponsorships: get slashed in the first one, unstake normally from the second one
            // sponsor the 1st sponsorship more to keep it running, so that operator can be slashed for leaving while it's running
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            const sponsorship = await deploySponsorship(sharedContracts, { penaltyPeriodSeconds: 2000 }) // > 1000 so slashing will happen
            const sponsorship2 = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("2000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship2.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorships")
            await (await operator.stake(sponsorship.address, parseEther("1000"))).wait()
            await (await operator.stake(sponsorship2.address, parseEther("1000"))).wait()

            await advanceToTimestamp(timeAtStart + 150, "Check that unstaking would give correct penalty")
            await expect(operator.unstake(sponsorship.address))
                .to.be.revertedWithCustomError(sponsorship, "LeavePenalty").withArgs(parseEther("100")) // 10% of the 1000 DATA stake

            // notice: 100 DATA slashing is taken from the operator's cut (38 DATA), and the remaining 62 DATA reduces the Profit
            await advanceToTimestamp(timeAtStart + 200, "Unstake from sponsorships")
            await expect(operator.forceUnstake(sponsorship.address, 0))
                .to.emit(operator, "Profit").withArgs(parseEther("90"), parseEther("0"), parseEther("10"))
            await expect(operator.unstake(sponsorship2.address))
                .to.emit(operator, "Profit").withArgs(parseEther("152"), parseEther("38"), parseEther("10"))
        })
    })

    describe("Undelegation queue", function(): void {
        it("empties the whole Operator of DATA when everyone undelegates all (infinity)", async function(): Promise<void> {
            const { token, streamrConfig } = sharedContracts

            await (await streamrConfig.setMinimumSelfDelegationFraction("1")).wait()

            await setTokens(operatorWallet, "100")
            await setTokens(delegator, "200")
            await setTokens(sponsor, "600")

            const sponsorship = await deploySponsorship(sharedContracts, { allocationWeiPerSecond: parseEther("20") })
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("600"), "0x")).wait()
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 10 })
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("100"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("200"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("300")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            // earnings = the whole sponsorship = 600 DATA
            // protocol fee = 600 * 0.05 = 30 DATA
            // operator's cut = (600 - 30) * 0.1 = 57 DATA
            // profit = 600 - 30 - 57 = 513 DATA
            await advanceToTimestamp(timeAtStart + 31, "Unstake after Sponsorship is empty")
            expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("900.0") // stake + earnings
            await expect(operator.unstake(sponsorship.address))
                .to.emit(operator, "Unstaked").withArgs(sponsorship.address)
                .to.emit(operator, "Profit").withArgs(parseEther("513"), parseEther("57"), parseEther("30"))
            expect(await token.balanceOf(sponsorship.address)).to.equal(0)
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("870.0") // stake + earnings - protocol fee

            // operator can't undelegate-all yet, since there's still another delegator
            await expect(operator.undelegate(parseEther("100000")))
                .to.be.revertedWith("error_selfDelegationTooLow")

            // operator contract value = 300 stake + 513 profits = 813 DATA
            // delegator has 2/3 of operator tokens, and should receive 2/3 * 813 = 542 DATA
            await advanceToTimestamp(timeAtStart + 40, "Undelegate all")
            expect(formatEther(await operator.balanceOf(delegator.address))).to.equal("200.0")
            await expect(operator.connect(delegator).undelegate(parseEther("542")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("542"), 0)
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("542"))
            expect(await operator.balanceOf(delegator.address)).to.equal(0)
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("542.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("328.0") // 870 - 542 sent out

            // operator had 1/3 of operator tokens, and should receive 1/3 * 813 = 271 DATA for their self-delegation
            // additionally it received the operator's cut of 57 DATA, so total 328 DATA
            await expect(operator.undelegate(parseEther("100000"))) // infinity = undelegate all
                .to.emit(operator, "QueuedDataPayout").withArgs(operatorWallet.address, parseEther("100000"), 1)
                .to.emit(operator, "Undelegated").withArgs(operatorWallet.address, parseEther("328"))
            expect(await operator.balanceOf(operatorWallet.address)).to.equal(0)
            expect(formatEther(await token.balanceOf(operatorWallet.address))).to.equal("328.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
        })

        it("pays out 1 queue entry fully using earnings withdrawn from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no DATA in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("200")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("200"), 0)
            expect(await operator.queuePositionOf(delegator.address)).to.equal(1)

            // earnings are 1 token/second * 1000 seconds = 1000
            //  minus protocol fee 5% = 50 DATA => 950 DATA remains
            //  operator's cut is 20% = 950 * 0.2 = 190 DATA
            //  pool value profit shared among all delegators is 950 - 190 = 760 DATA
            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("200"))
                .to.emit(operator, "QueueUpdated").withArgs(delegator.address, 0, 0)

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("200.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("750.0")
        })

        it("pays out 1 queue entry partially using earnings withdrawn from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "5000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("5000"), "0x")).wait()
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no DATA in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("2000")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("2000"), 0)

            // earnings are 1 token/second * 2000 seconds = 2000
            //  minus protocol fee 5% = 100 DATA => 1900 DATA remains
            //  operator's cut is 20% = 1900 * 0.2 = 380 DATA
            //  pool value profit shared among all delegators is 1900 - 380 = 1520 DATA
            await advanceToTimestamp(timeAtStart + 2000, "withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("1520"), parseEther("380"), parseEther("100"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("1900"))
                .to.emit(operator, "QueueUpdated").withArgs(delegator.address, parseEther("100"), 0)

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("1900.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
        })

        it("pays out multiple queue places, before and after withdrawing earnings from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            // queue payout
            await operator.connect(delegator).undelegate(parseEther("100"))
            await operator.connect(delegator).undelegate(parseEther("100"))
            expect(await operator.queuePositionOf(delegator.address)).to.equal(2)

            await advanceToTimestamp(timeAtStart + 1000, "withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
            expect(await operator.queuePositionOf(delegator.address)).to.equal(1)

            await operator.connect(delegator).undelegate(parseEther("1000000"))
            expect(await operator.queuePositionOf(delegator.address)).to.equal(1)

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("950.0")
        })

        it("pays out the remaining operator tokens even if the delegator moves some operator tokens away while queueing", async (): Promise<void> => {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no DATA in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("600")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"), 0)

            // move operator tokens away, leave only 100 to the delegator; that will be the whole amount of the exit, not 600
            await operator.connect(delegator).transfer(sponsor.address, parseEther("900"))
            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("100"))

            // earnings are 1000, minus protocol fee 5% = 50 DATA => 950 DATA remains
            // operator's cut is 20% = 950 * 0.2 = 190 DATA => profit shared by delegators is 950 - 190 = 760 DATA
            // pool value before self-delegation is 1000 stake + 760 profit = 1760 DATA
            // There are 1000 OperatorTokens => exchange rate is 1760 / 1000 = 1.76 DATA/OperatorToken
            // delegator should receive a payout: 100 OperatorTokens * 1.76 DATA = 176 DATA
            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("176"))

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("176.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("774.0")
        })

        it("pays out nothing if the delegator moves ALL their operator tokens away while queueing", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no DATA in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("600")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"), 0)

            // move operator tokens away, nothing can be exited, although nominally there's still 600 in the queue
            await operator.connect(delegator).transfer(sponsor.address, parseEther("1000"))
            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
                .to.not.emit(operator, "Undelegated")

            // earnings are 1000, minus protocol fee 5% = 50 DATA => 950 DATA remains
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("950.0")
        })

        it("accepts forced takeout from non-operator after grace period is over (negative + positive test)", async function(): Promise<void> {
            const { token, streamrConfig } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()
            const gracePeriod = +await streamrConfig.maxQueueSeconds()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            await advanceToTimestamp(timeAtStart + 1000, "Queue for undelegation")
            await operator.connect(delegator).undelegate(parseEther("176"))

            await advanceToTimestamp(timeAtStart + gracePeriod, "Force unstaking attempt")
            await expect(operator.connect(delegator).forceUnstake(sponsorship.address, 10))
                .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")

            // after gracePeriod, anyone can trigger the unstake and payout of the queue
            // earnings are 1000, minus protocol fee 5% = 50 DATA => 950 DATA remains
            // operator's cut is 20% = 950 * 0.2 = 190 DATA => profit shared by delegators is 950 - 190 = 760 DATA
            // pool value before self-delegation is 1000 stake + 760 profit = 1760 DATA
            // There are 1000 OperatorTokens => exchange rate is 1760 / 1000 = 1.76 DATA/OperatorToken
            // delegator should receive a payout: 100 OperatorTokens * 1.76 DATA = 176 DATA
            await advanceToTimestamp(timeAtStart + 2000 + gracePeriod, "Force unstaking")
            await expect(operator.connect(delegator).forceUnstake(sponsorship.address, 10))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("176"))

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("176.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("1774.0") // stake = 1000, remaining earnings = 950 - 176 = 774
        })

        it("pays out the queue on withdrawEarningsFromSponsorships", async () => {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet) // zero operator's share
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait() // 1000 DATA in Operator
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait() // 1000 available to be earned

            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            await advanceToTimestamp(timeAtStart + 1000, "Queue for undelegation")
            await(await operator.connect(delegator).undelegate(parseEther("195"))).wait()

            // delegator is queued, but no funds were moved yet
            expect(await token.balanceOf(delegator.address)).to.equal(parseEther("0"))
            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("1000"))

            // earnings are 1000, minus protocol fee 5% = 50 DATA => 950 DATA remains
            // operator's cut is 0% => pool value becomes 1000 stake + 950 profit = 1950 DATA
            // There are 1000 OperatorTokens => exchange rate is 1950 / 1000 = 1.95 DATA/OperatorToken
            // delegator should receive a payout: 100 OperatorTokens * 1.95 DATA = 195 DATA
            await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
                .to.emit(operator, "Profit").withArgs(parseEther("950"), parseEther("0"), parseEther("50"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("195"))

            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("900")) // 100 Operator tokens are burned
            expect(await token.balanceOf(delegator.address)).to.equal(parseEther("195"))
            expect(await token.balanceOf(operator.address)).to.equal(parseEther("755"))
        })

        it("edge case many queue entries, one sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            const operator = await deployOperator(operatorWallet)
            const balanceBefore = await token.balanceOf(delegator.address)
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            // await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            // queue payout
            const numberOfQueueSlots = 2
            for (let i = 0; i < numberOfQueueSlots; i++) {
                await operator.connect(delegator).undelegate(parseEther("1"))
            }

            await operator.unstake(sponsorship.address, { gasLimit: 0xF42400 })

            const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
            const balanceAfter = await token.balanceOf(delegator.address)
            expect(balanceAfter).to.equal(expectedBalance)
        })

        it("pays out exactly the requested DATA amount, if the whole balance was queued and new earnings are added while in the queue", async () => {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            expect(await operator.balanceInData(delegator.address)).to.equal(parseEther("1000"))

            await expect(operator.connect(delegator).undelegate(parseEther("1000")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("1000"), 0)

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.unstake(sponsorship.address))
                .to.emit(operator, "Profit").withArgs(parseEther("760"), parseEther("190"), parseEther("50"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("1000"))

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("1000.0")
            expect(formatEther(await operator.balanceInData(delegator.address))).to.equal("760.000000000000000001")
        })

    })

    // https://hackmd.io/Tmrj2OPLQwerMQCs_6yvMg
    it("forced example scenario", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.connect(delegator2).transfer(admin.address, await token.balanceOf(delegator2.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("100"))).wait()
        await (await token.mint(delegator2.address, parseEther("100"))).wait()
        await (await token.mint(delegator3.address, parseEther("100"))).wait()

        const days = 24 * 60 * 60
        const operator = await deployOperator(operatorWallet)
        await (await token.connect(delegator).transferAndCall(operator.address, parseEther("100"), "0x")).wait()
        await (await token.connect(delegator2).transferAndCall(operator.address, parseEther("100"), "0x")).wait()
        await (await token.connect(delegator3).transferAndCall(operator.address, parseEther("100"), "0x")).wait()

        const sponsorship1 = await deploySponsorship(sharedContracts)
        const sponsorship2 = await deploySponsorship(sharedContracts)
        await operator.stake(sponsorship1.address, parseEther("200"))
        await operator.stake(sponsorship2.address, parseEther("100"))

        const timeAtStart = await getBlockTimestamp()

        // Starting state
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await operator.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await operator.balanceOf(delegator3.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await operator.queueIsEmpty()).to.equal(true)

        await advanceToTimestamp(timeAtStart + 0*days, "Delegator 1 enters the exit queue")
        await operator.connect(delegator).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 5*days, "Delegator 2 enters the exit queue")
        await operator.connect(delegator2).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 29*days, "Delegator 1 wants to force-unstake too early")
        await expect(operator.connect(delegator).forceUnstake(sponsorship1.address, 100))
            .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")

        await advanceToTimestamp(timeAtStart + 31*days, "Operator unstakes 5 data from sponsorship1")
        await operator.reduceStakeTo(sponsorship1.address, parseEther("150"))

        // sponsorship1 has 15 stake left, sponsorship2 has 10 stake left
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("50"))

        // now anyone can trigger the unstake and payout of the queue
        await expect(operator.connect(delegator2).forceUnstake(sponsorship1.address, 10))
            .to.emit(operator, "Unstaked").withArgs(sponsorship1.address)

        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator3.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator2.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator3.address)).to.equal(parseEther("100"))
        expect(await operator.queueIsEmpty()).to.equal(true)
    })

    describe("DefaultDelegationPolicy", () => {
        beforeEach(async () => {
            await setTokens(operatorWallet, "3000")
            await setTokens(delegator, "15000")
            await (await sharedContracts.streamrConfig.setMinimumSelfDelegationFraction(parseEther("0.1"))).wait()
        })
        afterEach(async () => {
            await (await sharedContracts.streamrConfig.setMinimumSelfDelegationFraction("0")).wait()
        })

        it("prevents delegations after operator withdraws all of its stake (operator value goes to zero)", async function(): Promise<void> {
            // TODO
        })

        it("negativetest minimumSelfDelegationFraction, cannot join when operators stake too small", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(operatorWallet)
            // operator should have 111.2 operator tokens, but has nothing
            await expect(token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x"))
                .to.be.revertedWith("error_selfDelegationTooLow")
        })

        it("negativetest minimumSelfDelegationFraction, can't delegate if the operator's share would fall too low", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(operatorWallet)
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("9000"), "0x")).wait() // 1:9 = 10% is ok
            await expect(token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")) // 1:10 < 10% not ok
                .to.be.revertedWith("error_selfDelegationTooLow")
        })

        it("positivetest minimumSelfDelegationFraction, can delegate", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(operatorWallet)
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("113"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        })
    })

    it("gets notified when kicked (IOperator interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "1000")
        await setTokens(sponsor, "1000")

        const sponsorship = await deploySponsorship(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const operator = await deployOperator(operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
        expect(await operator.valueWithoutEarnings()).to.equal(parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Slash, update operator value")
        await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
            .to.emit(operator, "Profit").withArgs(parseEther("950"), 0, parseEther("50"))
        expect(await operator.valueWithoutEarnings()).to.equal(parseEther("1950"))

        // TestKickPolicy actually kicks and slashes given amount (here, 10)
        await expect(sponsorship.connect(admin).voteOnFlag(operator.address, hexZeroPad(parseEther("10").toHexString(), 32)))
            .to.emit(sponsorship, "OperatorKicked").withArgs(operator.address)
        expect(await operator.valueWithoutEarnings()).to.equal(parseEther("1940"))
    })

    it("reduces operator value when it gets slashed without kicking (IOperator interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "1000")
        await setTokens(sponsor, "1000")

        const sponsorship = await deploySponsorship(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const operator = await deployOperator(operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        // update valueWithoutEarnings
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        await expect(operator.withdrawEarningsFromSponsorships([sponsorship.address]))
            .to.emit(operator, "Profit").withArgs(parseEther("950"), 0, parseEther("50"))
        expect(await operator.valueWithoutEarnings()).to.equal(parseEther("1950"))

        await (await sponsorship.connect(admin).flag(operator.address, "")).wait() // TestKickPolicy actually slashes 10 ether without kicking
        expect(await operator.valueWithoutEarnings()).to.equal(parseEther("1940"))
    })

    it("calculates totalStakeInSponsorships and valueWithoutEarnings correctly after flagging+slashing", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "2000")

        const operator = await deployOperator(operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("2000"), "0x")).wait()
        const sponsorship = await deploySponsorship(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const sponsorship2 = await deploySponsorship(sharedContracts)

        const totalStakeInSponsorshipsBeforeStake = await operator.totalStakedIntoSponsorshipsWei()
        const valueBeforeStake = await operator.valueWithoutEarnings()
        await (await operator.stake(sponsorship.address, parseEther("1000"))).wait()
        await (await operator.stake(sponsorship2.address, parseEther("1000"))).wait()
        const totalStakeInSponsorshipsAfterStake = await operator.totalStakedIntoSponsorshipsWei()
        const valueAfterStake = await operator.valueWithoutEarnings()

        await (await sponsorship.connect(admin).flag(operator.address, "")).wait() // TestKickPolicy actually slashes 10 ether without kicking
        const totalStakeInSponsorshipsAfterSlashing = await operator.totalStakedIntoSponsorshipsWei()
        const valueAfterSlashing = await operator.valueWithoutEarnings()

        expect(totalStakeInSponsorshipsBeforeStake).to.equal(parseEther("0"))
        expect(valueBeforeStake).to.equal(parseEther("2000"))
        expect(totalStakeInSponsorshipsAfterStake).to.equal(parseEther("2000"))
        expect(valueAfterStake).to.equal(parseEther("2000"))
        expect(totalStakeInSponsorshipsAfterSlashing).to.equal(parseEther("2000"))
        expect(valueAfterSlashing).to.equal(parseEther("1990"))
    })

    it("calculates totalStakeInSponsorships and valueWithoutEarnings correctly after slashing+unstake", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "2000")
        await setTokens(sponsor, "60")

        const operator = await deployOperator(operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("2000"), "0x")).wait()
        const penaltyPeriodSeconds = 60 // trigger penalty check e.g. `block.timestamp >= joinTimestamp + penaltyPeriodSeconds`
        const allocationWeiPerSecond = parseEther("0") // avoind earnings additions
        const sponsorship1 = await deploySponsorship(sharedContracts, { penaltyPeriodSeconds, allocationWeiPerSecond })
        await (await token.connect(sponsor).transferAndCall(sponsorship1.address, parseEther("60"), "0x")).wait()
        const sponsorship2 = await deploySponsorship(sharedContracts)

        await (await operator.stake(sponsorship1.address, parseEther("1000"))).wait()
        await (await operator.stake(sponsorship2.address, parseEther("1000"))).wait()
        const totalStakeInSponsorshipsBeforeSlashing = await operator.totalStakedIntoSponsorshipsWei()
        const valueBeforeSlashing = await operator.valueWithoutEarnings()

        await (await operator.forceUnstake(sponsorship1.address, parseEther("1000"))).wait()
        const totalStakeInSponsorshipsAfterSlashing = await operator.totalStakedIntoSponsorshipsWei()
        const valueAfterSlashing = await operator.valueWithoutEarnings()

        expect(totalStakeInSponsorshipsBeforeSlashing).to.equal(parseEther("2000"))
        expect(valueBeforeSlashing).to.equal(parseEther("2000"))
        expect(totalStakeInSponsorshipsAfterSlashing).to.equal(parseEther("1000"))
        expect(valueAfterSlashing).to.equal(parseEther("1900"))
    })

    it("will NOT let anyone else to stake except the operator of the Operator", async function(): Promise<void> {
        const operator = await deployOperator(operatorWallet)
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.connect(admin).stake(sponsorship.address, parseEther("1000")))
            .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
    })

    it("will NOT allow staking to non-Sponsorships", async function(): Promise<void> {
        const operator = await deployOperator(operatorWallet)
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.stake(sharedContracts.token.address, parseEther("1000")))
            .to.be.revertedWithCustomError(operator, "AccessDeniedStreamrSponsorshipOnly")
    })

    it("will NOT allow staking to Sponsorships that were not created using the correct SponsorshipFactory", async function(): Promise<void> {
        const operator = await deployOperator(operatorWallet)
        const sponsorship = await deploySponsorship(sharedContracts)
        const badSponsorship = sharedContracts.sponsorshipTemplate
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.stake(badSponsorship.address, parseEther("1000")))
            .to.be.revertedWithCustomError(operator, "AccessDeniedStreamrSponsorshipOnly")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
    })

    it("will NOT allow staking if there are delegators queueing to exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "5000")

        const sponsorship = await deploySponsorship(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("5000"), "0x")).wait()
        const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 25 })
        await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()

        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"), 0)

        expect(await operator.queueIsEmpty()).to.be.false
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.be.revertedWithCustomError(operator, "FirstEmptyQueueThenStake")

        await expect(operator.unstake(sponsorship.address))
            .to.emit(operator, "Unstaked")

        expect(await operator.queueIsEmpty()).to.be.true
        await expect(operator.stake(sponsorship.address, parseEther("500")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
    })

    it("will NOT allow delegating using wrong token", async function(): Promise<void> {
        const { token } = sharedContracts
        const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())

        await (await newToken.mint(admin.address, parseEther("1000"))).wait()
        const operator = await deployOperator(operatorWallet, { operatorsCutPercent: 25 })
        await expect(newToken.transferAndCall(operator.address, parseEther("100"), "0x"))
            .to.be.revertedWithCustomError(operator, "AccessDeniedDATATokenOnly")

        await (await token.mint(admin.address, parseEther("1000"))).wait()
        await expect(token.transferAndCall(operator.address, parseEther("100"), "0x"))
            .to.emit(operator, "Delegated").withArgs(admin.address, parseEther("100"))
    })

    // streamrConfig.minimumDelegationWei = 1 DATA
    it("undelegate completely if the amount left would be less than the minimum delegation amount", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "101")
        const operator = await deployOperator(operatorWallet)
        await (await token.connect(delegator).approve(operator.address, parseEther("100.5"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("100.5")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("100.5"))
        const contractBalanceAfterDelegate = await token.balanceOf(operator.address)

        // undelegating 100 will send 100.5 to delegator to meet the minimum-delegation-or-nothing requirement
        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            // undelegates the entire stake (100.5) since the amount left would be less than the minimumDelegationWei (1.0)
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("100.5"))
        const contractBalanceAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(contractBalanceAfterDelegate)).to.equal("100.5")
        expect(formatEther(contractBalanceAfterUndelegate)).to.equal("0.0")
    })

    it("undelegate less than the minimum delegation amount if more is staked into sponsorship", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "101")
        const minimumDelegationWei = parseEther("10")
        const operator = await deployOperator(operatorWallet, { minimumDelegationWei })
        await (await token.connect(delegator).approve(operator.address, parseEther("101"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("101")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("101"))
        const contractBalanceAfterDelegate = await token.balanceOf(operator.address)

        // stake 60 into sponsorship => 51 DATA remains in operator contract
        const sponsorship = await deploySponsorship(sharedContracts)
        await expect(operator.stake(sponsorship.address, parseEther("60")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        // undelegating 100 will send 41 to delegator => minimum delegation amount does NOT matter since more tokens (60) are staked in sponsorship
        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("41"))
        const contractBalanceAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(contractBalanceAfterDelegate)).to.equal("101.0")
        expect(formatEther(contractBalanceAfterUndelegate)).to.equal("0.0")
    })

    // streamrConfig.minimumDelegationWei = 1 DATA
    it("enforce delegator to keep the minimum delegation amount on operatortoken transfer", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "100")
        const operator = await deployOperator(operatorWallet)
        await (await token.connect(delegator).approve(operator.address, parseEther("100"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("100")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("100"))
        const contractBalanceAfterDelegate = await token.balanceOf(operator.address)

        // delegator can send tokens to another address if the minimum delegation amount is left after transfer
        await operator.connect(delegator).transfer(delegator2.address, parseEther("50"))
        const delegationRemaining = await operator.balanceOf(delegator.address)

        // delegator can NOT send tokens to another address if the minimum delegation amount is NOT left after transfer
        await expect(operator.connect(delegator).transfer(delegator2.address, parseEther("49.5")))
            .to.be.revertedWithCustomError(operator, "DelegationBelowMinimum")

        expect(contractBalanceAfterDelegate).to.equal(parseEther("100"))
        expect(delegationRemaining).to.equal(parseEther("50"))
    })

    describe("Node addresses", function(): void {
        function dummyAddressArray(length: number): string[] {
            return Array.from({ length }, (_, i) => i).map((i) => `0x${(i + 1).toString().padStart(40, "0")}`)
        }

        it("can ONLY be updated by the operator", async function(): Promise<void> {
            const operator = await deployOperator(operatorWallet)
            await expect(operator.connect(admin).setNodeAddresses([admin.address]))
                .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")
            await expect(operator.connect(admin).updateNodeAddresses([], [admin.address]))
                .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")
            await expect(operator.setNodeAddresses([admin.address]))
                .to.emit(operator, "NodesSet").withArgs([admin.address])
            await expect(operator.getNodeAddresses()).to.eventually.deep.equal([admin.address])
            await expect(operator.updateNodeAddresses([], [admin.address]))
                .to.emit(operator, "NodesSet").withArgs([])
            await expect(operator.getNodeAddresses()).to.eventually.deep.equal([])
        })

        it("can be set all at once (setNodeAddresses positive test)", async function(): Promise<void> {
            const operator = await deployOperator(operatorWallet)
            const addresses = dummyAddressArray(6)
            await (await operator.setNodeAddresses(addresses.slice(0, 4))).wait()
            expect(await operator.getNodeAddresses()).to.have.members(addresses.slice(0, 4))
            expect(await Promise.all(addresses.map((a) => operator.nodeIndex(a)))).to.deep.equal([1, 2, 3, 4, 0, 0])
            await (await operator.setNodeAddresses(addresses.slice(2, 6))).wait()
            expect(await operator.getNodeAddresses()).to.have.members(addresses.slice(2, 6))
            expect(await Promise.all(addresses.map((a) => operator.nodeIndex(a)))).to.deep.equal([0, 0, 3, 4, 2, 1])
            await (await operator.setNodeAddresses(addresses.slice(1, 5))).wait()
            expect(await operator.getNodeAddresses()).to.have.members(addresses.slice(1, 5))
            expect(await Promise.all(addresses.map((a) => operator.nodeIndex(a)))).to.deep.equal([0, 1, 3, 4, 2, 0])
        })

        it("can be set 'differentially' (updateNodeAddresses positive test)", async function(): Promise<void> {
            const operator = await deployOperator(operatorWallet)
            const addresses = dummyAddressArray(6)
            await (await operator.setNodeAddresses(addresses.slice(0, 4)))

            await (await operator.updateNodeAddresses(addresses.slice(2, 6), addresses.slice(0, 2))).wait()
            expect(await operator.getNodeAddresses()).to.have.members(addresses.slice(2, 6))
            await expect(operator.updateNodeAddresses([], addresses.slice(0, 5)))
                .to.emit(operator, "NodesSet").withArgs([addresses[5]])
            await expect(operator.updateNodeAddresses([], []))
                .to.emit(operator, "NodesSet").withArgs([addresses[5]])
            await expect(operator.updateNodeAddresses([addresses[3]], []))
                .to.emit(operator, "NodesSet").withArgs([addresses[5], addresses[3]])
        })

        it("can call flagging functions", async function(): Promise<void> {
            // hardhat accounts 1, 2, 3 will be used by setupSponsorships, see "before" hook which they are
            await setTokens(sponsor, "1000")
            await setTokens(operatorWallet, "1000")
            await setTokens(operator2Wallet, "1000")
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(sharedContracts, [3], this.test!.title, { sponsor: false })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, "Flag starts")
            await (await flagger.setNodeAddresses([])).wait()
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.be.revertedWithCustomError(flagger, "AccessDeniedNodesOnly")

            await (await flagger.setNodeAddresses([await flagger.owner()])).wait()
            await expect(flagger.flag(sponsorship.address, target.address, ""))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address, "")

            await advanceToTimestamp(start + VOTE_START, "Voting starts")
            await (await voter.setNodeAddresses([])).wait()
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWithCustomError(voter, "AccessDeniedNodesOnly")

            await (await voter.setNodeAddresses([await voter.owner()])).wait()
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(target, "Unstaked").withArgs(sponsorship.address)
        })

        it("can call heartbeat", async function(): Promise<void> {
            const operator = await deployOperator(operatorWallet)
            await expect(operator.heartbeat("{}")).to.be.revertedWithCustomError(operator, "AccessDeniedNodesOnly")
            await (await operator.setNodeAddresses([delegator2.address])).wait()
            await expect(operator.connect(delegator2).heartbeat("{}"))
                .to.emit(operator, "Heartbeat").withArgs(delegator2.address, "{}")
        })
    })

    it("allows controllers to act on behalf of the operator", async function(): Promise<void> {
        const operator = await deployOperator(operatorWallet)
        await expect(operator.connect(controller).setNodeAddresses([controller.address]))
            .to.be.revertedWithCustomError(operator, "AccessDeniedOperatorOnly")
        await (await operator.grantRole(await operator.CONTROLLER_ROLE(), controller.address)).wait()
        await operator.connect(controller).setNodeAddresses([controller.address])
    })

})
