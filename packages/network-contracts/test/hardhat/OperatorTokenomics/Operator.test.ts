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
    let delegator: Wallet       // puts DATA into Operator contract
    let delegator2: Wallet
    let delegator3: Wallet
    let controller: Wallet      // acts on behalf of operatorWallet

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

    async function deployOperator(contracts: TestContracts, deployer: Wallet, opts?: any) {
        // we want to re-deploy the OperatorFactory (not all the policies or SponsorshipFactory)
        // so that same operatorWallet can create a clean contract (OperatorFactory prevents several contracts from same deployer)
        const newContracts = {
            ...contracts,
            ...await deployOperatorFactory(contracts, deployer)
        }

        return deployOperatorContract(newContracts, deployer, opts)
    }

    before(async (): Promise<void> => {
        [admin, sponsor, operatorWallet, delegator, delegator2, delegator3, controller] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)

        testKickPolicy = await (await (await getContractFactory("TestKickPolicy", admin)).deploy()).deployed() as unknown as IKickPolicy
        await (await sharedContracts.sponsorshipFactory.addTrustedPolicies([ testKickPolicy.address])).wait()
    })

    it("allows delegate and undelegate", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(delegator).approve(operator.address, parseEther("1000"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("1000")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("1000"), parseEther("1000"))
        const freeFundsAfterdelegate = await token.balanceOf(operator.address)

        await expect(operator.connect(delegator).undelegate(parseEther("1000")))
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("1000"), parseEther("0"))
        const freeFundsAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(freeFundsAfterdelegate)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("allows delegate, transfer of poolTokens, and undelegate by another delegator", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(delegator).approve(operator.address, parseEther("1000"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("1000")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("1000"), parseEther("1000"))
        const freeFundsAfterdelegate = await token.balanceOf(operator.address)

        await (await operator.connect(delegator).transfer(delegator2.address, parseEther("1000"))).wait()

        await expect(operator.connect(delegator2).undelegate(parseEther("1000")))
            .to.emit(operator, "Undelegated").withArgs(delegator2.address, parseEther("1000"), parseEther("0"))
        const freeFundsAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(freeFundsAfterdelegate)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("stakes, and unstakes with gains", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")
        const sponsorship = await deploySponsorship(sharedContracts)
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
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

        const gains = (await token.balanceOf(operator.address)).sub(balanceBefore)
        expect(formatEther(gains)).to.equal("1000.0") // 200 operator fee was automatically re-delegated (it never left the contract)
    })

    it("stakes, then stakes more", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "2000")
        const sponsorship = await deploySponsorship(sharedContracts)
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
        await (await token.connect(delegator).transferAndCall(operator.address, parseEther("2000"), "0x")).wait()

        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("1000"), parseEther("1000"))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        await expect(operator.stake(sponsorship.address, parseEther("500")))
            .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("1500"), parseEther("1500"))
            .to.not.emit(operator, "Staked")

        await expect(operator.stake(sponsorship.address, parseEther("500")))
            .to.emit(operator, "StakeUpdate").withArgs(sponsorship.address, parseEther("2000"), parseEther("2000"))
            .to.not.emit(operator, "Staked")
    })

    describe("DefaultDelegationPolicy", () => {
        beforeEach(async () => {
            await setTokens(operatorWallet, "3000")
            await setTokens(delegator, "15000")
        })
        it("negativetest minoperatorstakepercent, cannot join when operators stake too small", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(sharedContracts, operatorWallet, { minOperatorStakePercent: 10 })
            // operator should have 111.2 operator tokens, but has nothing
            await expect(token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x"))
                .to.be.revertedWith("error_joinPolicyFailed")
        })

        it("negativetest minoperatorstakepercent, delegator can't join if the operator's stake would fall too low", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(sharedContracts, operatorWallet, { minOperatorStakePercent: 10 })
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("10000"), "0x")).wait()
            await expect(token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x"))
                .to.be.revertedWith("error_joinPolicyFailed")
        })

        it("positivetest minoperatorstakepercent, can join", async function(): Promise<void> {
            const { token } = sharedContracts
            const operator = await deployOperator(sharedContracts, operatorWallet, { minOperatorStakePercent: 10 })
            await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("113"), "0x")).wait()
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        })
    })

    it("updates approximate operator value when updateApproximatePoolvalueOfSponsorship is called", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(sponsor, "1000")
        await setTokens(operatorWallet, "1000")
        const operator = await deployOperator(sharedContracts, operatorWallet)
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await (await operator.stake(sponsorship.address, parseEther("1000"))).wait()

        // some time passes => approx poolvalue differs from real poolvalue
        await advanceToTimestamp(timeAtStart + 1001, "Read the earnings back to Operator")

        const approxPoolValueBefore = await operator.getApproximatePoolValue()
        const actualPoolValueBefore = await operator.calculatePoolValueInData()
        const poolValuePerSponsorshipBefore = await operator.getApproximatePoolValuesPerSponsorship()

        await (await operator.updateApproximatePoolvalueOfSponsorship(sponsorship.address)).wait()

        const approxPoolValueAfter = await operator.getApproximatePoolValue()
        const actualPoolValueAfter = await operator.calculatePoolValueInData()
        const poolValuePerSponsorshipAfter = await operator.getApproximatePoolValuesPerSponsorship()

        expect(formatEther(approxPoolValueBefore)).to.equal("1000.0")
        expect(formatEther(actualPoolValueBefore)).to.equal("2000.0")
        expect(formatEther(poolValuePerSponsorshipBefore.approxValues[0])).to.equal("1000.0")
        expect(formatEther(poolValuePerSponsorshipBefore.realValues[0])).to.equal("2000.0")
        expect(poolValuePerSponsorshipBefore.sponsorshipAddresses[0]).to.equal(sponsorship.address)

        expect(formatEther(approxPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(actualPoolValueAfter)).to.equal("2000.0")
        expect(formatEther(poolValuePerSponsorshipAfter.approxValues[0])).to.equal("2000.0")
        expect(formatEther(poolValuePerSponsorshipAfter.realValues[0])).to.equal("2000.0")
        expect(poolValuePerSponsorshipAfter.sponsorshipAddresses[0]).to.equal(sponsorship.address)
    })

    it("re-delegates all of operator's share", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(sponsor, "1000")
        await setTokens(operatorWallet, "1000")
        await setTokens(delegator, "1000")
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
        expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("1000.0")

        const operator = await deployOperator(sharedContracts, operatorWallet, {
            minOperatorStakePercent: 20,
            operatorSharePercent: 20,
        })

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
        const operatorsDataBefore = await token.balanceOf(operatorWallet.address)

        // operator staked 100 DATA so they should have 100 Operator tokens
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal("100.0")
        expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
        expect(formatEther(await token.balanceOf(sponsorship.address))).to.equal("2000.0") // 1000 + 1000

        await advanceToTimestamp(timeAtStart + 500, "Withdraw earnings from sponsorship")
        // const dataEarned = 500 // 1 DATA per second => 500 DATA
        await operator.withdrawEarningsFromSponsorship(sponsorship.address)
        expect(await token.balanceOf(sponsorship.address)).to.equal(parseEther("1500.0")) // 2000 - 500
        expect(await token.balanceOf(operator.address)).to.equal(parseEther("500"))

        // despite operatorSharePercent=20%, operator should not have more DATA since 1000 of his earnings are staked (left in operator)
        const operatorsDataAfter = await token.balanceOf(operatorWallet.address)
        expect(operatorsDataAfter).to.equal(operatorsDataBefore)

        // operator's share of (500 * 20% = 100) DATA are added to the operator and minted for the operator
        // exchange rate is 1 operator token / DATA like it was before the withdraw

        // 0 DATA
        // 500 DATA - 100 DATA
        // const poolValueForCalculation = 1000 + dataEarned - 100
        // const currentAmountOfPoolTokens = 1000
        // const currentExchangeRate = currentAmountOfPoolTokens / poolValueForCalculation // 1000 / 1400 = 0.7142857143
        // const pooltoken = currentExchangeRate * dataEarned / 5 // 20% of the earnings => 71.42857143

        // 400 in pool
        // mint pooltoken according to 400 DATA
        // expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal(pooltoken + 100) // TODO: fix JS rounding error
        expect(formatEther(await operator.balanceOf(operatorWallet.address))).to.equal("171.428571428571428571") // 100 + 71.42857143
    })

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it("revenue sharing scenarios 1..7: happy path operator life cycle", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts

        // Setup:
        // - There is one single delegator with funds of 1000 DATA and no delegations.
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "2500")
        await setTokens(operatorWallet, "0")
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 }) // policy needed in part 4

        // 1: Simple Join/Delegate
        // "There is a maximum allocation policy of 500 DATA in this system." not implemented => simulate by only delegating 5 DATA
        await (await dataToken.connect(delegator).transferAndCall(operator.address, parseEther("500"), "0x")).wait()
        // delegator sends 500 DATA to operator => both have 500 DATA
        // delegator has 500 DATA
        // delegator has 500 pooltoken
        // OperatorContract has 500 DATA

        expect(await operator.connect(delegator).getMyBalanceInData()).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("500"))
        expect(await operator.totalSupply()).to.equal(parseEther("500"))

        // Setup for 2: sponsorship must be only 25 so at #6, Unstaked returns earnings=0
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await dataToken.connect(sponsor).transferAndCall(sponsorship.address, parseEther("2500"), "0x")).wait()
        const timeAtStart = await getBlockTimestamp()
        // sponsor has 0 DATA
        // sponsorship has 2500 DATA

        // 2: Simple Staking
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("500")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
        // operatorContract has 0 DATA
        // sponsorship has 3000 DATA

        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await dataToken.balanceOf(sponsorship.address)).to.equal(parseEther("3000")) // 2500 sponsorship + 500 stake
        expect(await operator.getPoolValueFromSponsorship(sponsorship.address)).to.equal(parseEther("500"))
        expect(await sponsorship.stakedWei(operator.address)).to.equal(parseEther("500"))
        expect(await sponsorship.getEarnings(operator.address)).to.equal(parseEther("0"))

        // 3: Yield Allocated to Accounts
        // Skip this: there is no yield allocation policy that sends incoming earnings directly to delegators

        // 4: Yield Allocated to Operator pool value
        await advanceToTimestamp(timeAtStart + 10000, "Withdraw from sponsorship") // only has 25 DATA sponsorship, so that's what it will allocate
        await (await operator.withdrawEarningsFromSponsorship(sponsorship.address)).wait()
        // sponsorship has 2500 DATA => operator withdraws them all, but
        // the operator's share is 20% => 500 DATA are re-delegated
        // TODO: add event to Operator
        // await expect(operator.withdrawEarningsFromSponsorship(sponsorship.address))
        //    .to.emit(operator, "Withdrawn").withArgs(sponsorship.address, parseEther("2500"))

        expect(await dataToken.balanceOf(operatorWallet.address)).to.equal(parseEther("0"))
        // poolValue = operator DATA tokens +
        //      operator stake in sponsorship + operator earnings from sponsorship - operator's share of the earnings(operator's share * allocation)
        //      = 2500 + 500 + 0 - 0.2 * 500 = 3000
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("3000"))
        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("2500"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("500"))

        // 5: Withdraw
        // Because the operator value is equal to 25 and the number of operator tokens is equal to 5, the exchange rate is 25/5.
        // This values each operator token as being worth 5 data.
        // Because there is 20 in terms of funds that is available currently, that is the amount of DATA which will be paid out.
        // 20 DATA / 5 Exchange Rate = 4 Operator Tokens are paid out, 1 operator token payout is put into the queue.
        await expect(operator.connect(delegator).undelegate(parseEther("500")))
            .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("500"))
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("2500"), parseEther("500"))

        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("3000"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))

        // 6: Pay out the queue by unstaking
        await expect(operator.unstake(sponsorship.address))
            .to.emit(operator, "Unstaked").withArgs(sponsorship.address)

        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("500"))
        expect(await dataToken.balanceOf(delegator.address)).to.equal(parseEther("3000")) // +5
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await operator.queueIsEmpty()).to.equal(true)

        // 7: skip, too similar to cases 4+5
    })

    it.skip("revenue sharing scenarios 8..10: slashing", async function(): Promise<void> {
        const { token: dataToken } = sharedContracts
        await setTokens(delegator, "10")
        await setTokens(operatorWallet, "10")

        // Setup:
        // - There is one sponsorship
        // - There is one operator that has staked 5 DATA into the sponsorship
        // - There is one delegator (with 5 DATA) who has staked 5 DATA into the operator (has 5 operator tokens)
        const sponsorship = await deploySponsorship(sharedContracts)
        // await (await dataToken.connect(sponsor).transferAndCall(sponsorship.address, parseEther("25"), "0x")).wait()
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 }) // policy needed in part 4
        await (await dataToken.connect(delegator).transferAndCall(operator.address, parseEther("5"), "0x")).wait()
        await expect(operator.stake(sponsorship.address, parseEther("5")))

        // 8: Slashing
        await expect(sponsorship.voteOnFlag(operator.address, parseEther("5").toHexString()))
            .to.emit(sponsorship, "StakeUpdate").withArgs(operator.address, parseEther("0"), parseEther("0"))

        expect(await dataToken.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("5"))
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("0"))
    })

    it("operator withdraws all of its stake, operator value goes to zero, no one can join anymore", async function(): Promise<void> {
        // TODO
    })

    describe("Undelegation queue", function(): void {

        it("pays out 1 queue entry fully using earnings withdrawn from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no free funds in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("100")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))
            expect(await operator.queuePositionOf(delegator.address)).to.equal(1)

            // earnings are 1 token/second * 1000 seconds = 1000, minus 200 operator fee = 800 DATA
            // poolvalue is 1000 stake + 800 earnings = 1800 DATA
            // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
            // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorship(sponsorship.address))
            // TODO: add event to Operator
            //    .to.emit(operator, "EarningsWithdrawn").withArgs(sponsorship.address, parseEther("1000"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("180"), parseEther("1000"))
            //    .to.emit(operator, "OperatorSharePaid").withArgs(sponsorship.address, parseEther("200"))

            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("820.0")
        })

        it("pays out 1 queue entry partially using earnings withdrawn from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "5000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("5000"), "0x")).wait()
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 25 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no free funds in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("1000")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("1000"))

            // earnings are 2000, minus 500 operator fee = 1500 DATA
            // 1500 DATA will be paid out
            // poolvalue is 1000 stake + 1500 earnings = 2500 DATA
            // There are 1000 PoolTokens => exchange rate is 2500 / 1000 = 2.5 DATA/PoolToken
            // PoolTokens to be burned: 1500 DATA = 1500/2.5 = 600 PoolTokens
            // Left in the queue: 1000 - 600 = 400 PoolTokens
            await advanceToTimestamp(timeAtStart + 2000, "withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorship(sponsorship.address))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("2000"), parseEther("1000"))
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("2000.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("0.0")
        })

        it("pays out multiple queue places, before and after withdrawing earnings from sponsorship", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
            const balanceBefore = await token.balanceOf(delegator.address)
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            // queue payout
            await operator.connect(delegator).undelegate(parseEther("500"))
            await operator.connect(delegator).undelegate(parseEther("400"))
            expect(await operator.queuePositionOf(delegator.address)).to.equal(2)

            await advanceToTimestamp(timeAtStart + 1000, "withdraw earnings from sponsorship")
            await operator.withdrawEarningsFromSponsorship(sponsorship.address)
            // TODO: enable next line
            await operator.connect(delegator).undelegate(parseEther("100"))
            // now queue should have been paid out from earnings
            // should equal balance before - 1000 (stake still staked) + 800 (yield)
            const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther("1000"))
            const balanceAfter = await token.balanceOf(delegator.address)
            expect(balanceAfter).to.equal(expectedBalance)
        })

        it("pays out the remaining operator tokens if the delegator moves some operator tokens away while queueing", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no free funds in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("600")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))

            // move operator tokens away, leave only 100 to the delegator; that will be the whole amount of the exit, not 600
            await operator.connect(delegator).transfer(sponsor.address, parseEther("900"))
            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("100"))

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorship(sponsorship.address))
            // TODO: add event to Operator
            //    .to.emit(operator, "EarningsWithdrawn").withArgs(sponsorship.address, parseEther("1000"))
                .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("180"), parseEther("1000"))
            //    .to.emit(operator, "OperatorSharePaid").withArgs(sponsorship.address, parseEther("200"))

            // earnings are 1000, minus 200 operator fee = 800 DATA
            // poolvalue is 1000 stake + 800 earnings = 1800 DATA
            // There are 1000 PoolTokens => exchange rate is 1800 / 1000 = 1.8 DATA/PoolToken
            // delegator should receive a payout: 100 PoolTokens * 1.8 DATA = 180 DATA
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("180.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("820.0")
        })

        it("pays out nothing if the delegator moves ALL their operator tokens away while queueing", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 20 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            const timeAtStart = await getBlockTimestamp()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship + queue the payout") // no free funds in the operator => no payout
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)
            await expect(operator.connect(delegator).undelegate(parseEther("600")))
                .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("600"))

            // move operator tokens away, nothing can be exited, although nominally there's still 600 in the queue
            await operator.connect(delegator).transfer(sponsor.address, parseEther("1000"))
            expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))

            await advanceToTimestamp(timeAtStart + 1000, "Withdraw earnings from sponsorship")
            await expect(operator.withdrawEarningsFromSponsorship(sponsorship.address))
            // TODO: add event to Operator
            //    .to.emit(operator, "EarningsWithdrawn").withArgs(sponsorship.address, parseEther("1000"))
                .to.not.emit(operator, "Undelegated")
            //    .to.emit(operator, "OperatorSharePaid").withArgs(sponsorship.address, parseEther("200"))

            // earnings are 1000, minus 200 operator fee = 800 DATA
            // opertor's fee is re-delegated => operator balance is 1000 DATA
            expect(formatEther(await token.balanceOf(delegator.address))).to.equal("0.0")
            expect(formatEther(await token.balanceOf(operator.address))).to.equal("1000.0")
        })

        it("accepts forced takeout from non-operator after grace period is over (negative + positive test)", async function(): Promise<void> {
            const { token } = sharedContracts
            await setTokens(delegator, "1000")
            await setTokens(sponsor, "1000")

            const sponsorship = await deploySponsorship(sharedContracts)
            const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 21 })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

            const timeAtStart = await getBlockTimestamp()
            const gracePeriod = +await operator.maxQueueSeconds()

            await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
            await expect(operator.stake(sponsorship.address, parseEther("1000")))
                .to.emit(operator, "Staked").withArgs(sponsorship.address)

            await advanceToTimestamp(timeAtStart + 1000, "Queue for undelegation")
            await operator.connect(delegator).undelegate(parseEther("100"))

            await advanceToTimestamp(timeAtStart + gracePeriod, "Force unstaking attempt")
            await expect (operator.connect(delegator).forceUnstake(sponsorship.address, 10)).to.be.revertedWith("error_onlyOperator")

            // now anyone can trigger the unstake and payout of the queue
            await advanceToTimestamp(timeAtStart + 2000 + gracePeriod, "Force unstaking")
            await (await operator.connect(delegator).forceUnstake(sponsorship.address, 10)).wait()

            // 1000 were staked, 1000 are earnings, 21% is operator's share
            //   => with 1000 PT existing, value of 1 PT is 1.86 DATA,
            //   => the 100 queued PT will pay out 186 DATA
            const balanceAfter = await token.balanceOf(delegator.address)

            expect(formatEther(balanceAfter)).to.equal("186.0")
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
        const operator = await deployOperator(sharedContracts, operatorWallet)
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
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("300"))
        expect(await token.balanceOf(operator.address)).to.equal(parseEther("0"))
        expect(await operator.queueIsEmpty()).to.equal(true)

        await advanceToTimestamp(timeAtStart + 0*days, "Delegator 1 enters the exit queue")
        await operator.connect(delegator).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 5*days, "Delegator 2 enters the exit queue")
        await operator.connect(delegator2).undelegate(parseEther("100"))

        await advanceToTimestamp(timeAtStart + 29*days, "Delegator 1 wants to force-unstake too early")
        await expect(operator.connect(delegator).forceUnstake(sponsorship1.address, 100)).to.be.revertedWith("error_onlyOperator")

        await advanceToTimestamp(timeAtStart + 31*days, "Operator unstakes 5 data from sponsorship1")
        await operator.reduceStakeTo(sponsorship1.address, parseEther("150"))

        // sponsorship1 has 15 stake left, sponsorship2 has 10 stake left
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("50"))
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("250"))

        // now anyone can trigger the unstake and payout of the queue
        // await (await operator.updateApproximatePoolvalueOfSponsorship(sponsorship2.address)).wait()
        // await (await operator.updateApproximatePoolvalueOfSponsorship(sponsorship1.address)).wait()
        await expect(operator.connect(delegator2).forceUnstake(sponsorship1.address, 10))
            .to.emit(operator, "Unstaked").withArgs(sponsorship1.address)

        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator2.address)).to.equal(parseEther("100"))
        expect(await token.balanceOf(delegator3.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator2.address)).to.equal(parseEther("0"))
        expect(await operator.balanceOf(delegator3.address)).to.equal(parseEther("100"))
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("100"))
        expect(await operator.queueIsEmpty()).to.equal(true)
    })

    it("edge case many queue entries, one sponsorship", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")

        const sponsorship = await deploySponsorship(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const operator = await deployOperator(sharedContracts, operatorWallet)
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

    it("punishes operator on too much diff on approx poolvalue", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "1000")
        await setTokens(delegator, "0")
        await setTokens(sponsor, "2000")

        const sponsorship1 = await deploySponsorship(sharedContracts)
        const sponsorship2 = await deploySponsorship(sharedContracts)
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship2.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship1.address, parseEther("500")))
            .to.emit(operator, "Staked").withArgs(sponsorship1.address)
        await expect(operator.stake(sponsorship2.address, parseEther("500")))
            .to.emit(operator, "Staked").withArgs(sponsorship2.address)

        // poolvalue will have changed, will be 3000, approx poolvalue will be 1000
        await advanceToTimestamp(timeAtStart + 5000, "withdraw earnings from sponsorship")
        expect(await operator.calculatePoolValueInData()).to.equal(parseEther("3000"))
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("1000"))
        expect(await operator.balanceOf(operatorWallet.address)).to.equal(parseEther("1000"))

        await operator.connect(delegator).updateApproximatePoolvalueOfSponsorships([sponsorship1.address, sponsorship2.address])
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("3000"))

        expect(await operator.balanceOf(operatorWallet.address)).to.equal(parseEther("995"))
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther("5"))
    })

    it("gets notified when kicked (IOperator interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "1000")
        await setTokens(sponsor, "1000")

        const sponsorship = await deploySponsorship(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        await advanceToTimestamp(timeAtStart + 1000, "Slash, update operator value")
        await operator.updateApproximatePoolvalueOfSponsorships([sponsorship.address])
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("2000"))

        // TestKickPolicy actually kicks and slashes given amount (here, 10)
        await expect(sponsorship.connect(admin).voteOnFlag(operator.address, hexZeroPad(parseEther("10").toHexString(), 32)))
            .to.emit(sponsorship, "OperatorKicked").withArgs(operator.address)
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("1990"))
    })

    it("reduces operator value when it gets slashed without kicking (IOperator interface)", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(operatorWallet, "1000")
        await setTokens(sponsor, "1000")

        const sponsorship = await deploySponsorship(sharedContracts, {}, [], [], undefined, undefined, testKickPolicy)
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

        const timeAtStart = await getBlockTimestamp()
        await advanceToTimestamp(timeAtStart, "Stake to sponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        // update poolvalue
        await advanceToTimestamp(timeAtStart + 1000, "slash")
        await operator.updateApproximatePoolvalueOfSponsorships([sponsorship.address])
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("2000"))

        await (await sponsorship.connect(admin).flag(operator.address)).wait() // TestKickPolicy actually slashes 10 ether without kicking
        expect(await operator.getApproximatePoolValue()).to.equal(parseEther("1990"))
    })

    it("will NOT let anyone else to stake except the operator of the Operator", async function(): Promise<void> {
        const operator = await deployOperator(sharedContracts, operatorWallet)
        const sponsorship = await deploySponsorship(sharedContracts)
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.connect(admin).stake(sponsorship.address, parseEther("1000")))
            .to.be.revertedWith("error_onlyOperator")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
    })

    it("will NOT allow staking to non-Sponsorships", async function(): Promise<void> {
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.stake(sharedContracts.token.address, parseEther("1000"))).to.be.revertedWith("error_badSponsorship")
    })

    it("will NOT allow staking to Sponsorships that were not created using the correct SponsorshipFactory", async function(): Promise<void> {
        const operator = await deployOperator(sharedContracts, operatorWallet)
        const sponsorship = await deploySponsorship(sharedContracts)
        const badSponsorship = sharedContracts.sponsorshipTemplate
        await (await sharedContracts.token.mint(operator.address, parseEther("1000"))).wait()
        await expect(operator.stake(badSponsorship.address, parseEther("1000")))
            .to.be.revertedWith("error_badSponsorship")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)
    })

    it("will NOT allow staking if there are delegators queueing to exit", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "5000")

        const sponsorship = await deploySponsorship(sharedContracts)
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("5000"), "0x")).wait()
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 25 })
        await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()

        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            .to.emit(operator, "QueuedDataPayout").withArgs(delegator.address, parseEther("100"))

        expect(await operator.queueIsEmpty()).to.be.false
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.be.revertedWith("error_firstEmptyQueueThenStake")

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
        const operator = await deployOperator(sharedContracts, operatorWallet, { operatorSharePercent: 25 })
        await expect(newToken.transferAndCall(operator.address, parseEther("100"), "0x"))
            .to.be.revertedWith("error_onlyDATAToken")

        await (await token.mint(admin.address, parseEther("1000"))).wait()
        await expect(token.transferAndCall(operator.address, parseEther("100"), "0x"))
            .to.emit(operator, "Delegated").withArgs(admin.address, parseEther("100"), parseEther("100"))
    })

    it("undelegate everything if the amount left would be less than the minimum delegation amount", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "101")
        const minimumDelegationWei = parseEther("10")
        const operator = await deployOperator(sharedContracts, operatorWallet, { minimumDelegationWei })
        await (await token.connect(delegator).approve(operator.address, parseEther("101"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("101")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("101"), parseEther("101"))
        const freeFundsAfterDelegate = await token.balanceOf(operator.address)

        // undelegating 100 will send 101 to delegator to meet the minimum delegation amount
        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            // undelegates the entire stake (101) since the amount left would be less than the minimumDelegationWei
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("101"), parseEther("0"))
        const freeFundsAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(freeFundsAfterDelegate)).to.equal("101.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("undelegate less than the minimum delegation amount if more is staked into sponsorship", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "101")
        const minimumDelegationWei = parseEther("10")
        const operator = await deployOperator(sharedContracts, operatorWallet, { minimumDelegationWei })
        await (await token.connect(delegator).approve(operator.address, parseEther("101"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("101")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("101"), parseEther("101"))
        const freeFundsAfterDelegate = await token.balanceOf(operator.address)

        // stake 60 into sponsorship => 51 DATA remains in operator contract
        const sponsorship = await deploySponsorship(sharedContracts)
        await expect(operator.stake(sponsorship.address, parseEther("60")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        // undelegating 100 will send 41 to delegator => minimum delegation amount does NOT matter since more tokens (60) are staked in sponsorship
        await expect(operator.connect(delegator).undelegate(parseEther("100")))
            .to.emit(operator, "Undelegated").withArgs(delegator.address, parseEther("41"), parseEther("60"))
        const freeFundsAfterUndelegate = await token.balanceOf(operator.address)

        expect(formatEther(freeFundsAfterDelegate)).to.equal("101.0")
        expect(formatEther(freeFundsAfterUndelegate)).to.equal("0.0")
    })

    it("enforce delegator to keep the minimum delegation amount on pooltoken transfer", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "100")
        const minimumDelegationWei = parseEther("10")
        const operator = await deployOperator(sharedContracts, operatorWallet, { minimumDelegationWei })
        await (await token.connect(delegator).approve(operator.address, parseEther("100"))).wait()
        await expect(operator.connect(delegator).delegate(parseEther("100")))
            .to.emit(operator, "Delegated").withArgs(delegator.address, parseEther("100"), parseEther("100"))
        const freeFundsAfterDelegate = await token.balanceOf(operator.address)
        expect(freeFundsAfterDelegate).to.equal(parseEther("100"))

        // delegator can send tokens to another address if the minimum delegation amount is kept
        await operator.connect(delegator).transfer(delegator2.address, parseEther("50"))
        const freeFundsBeforeTransfer = await operator.balanceOf(delegator.address)
        expect(freeFundsBeforeTransfer).to.equal(parseEther("50"))

        // delegator can NOT send tokens to another address if the minimum delegation amount is NOT kept
        await expect(operator.connect(delegator).transfer(delegator2.address, parseEther("41")))
            .to.be.revertedWith("error_minimumDelegationNotReached")
    })

    describe("Node addresses", function(): void {
        function dummyAddressArray(length: number): string[] {
            return Array.from({ length }, (_, i) => i).map((i) => `0x${(i + 1).toString().padStart(40, "0")}`)
        }

        it("can ONLY be updated by the operator", async function(): Promise<void> {
            const operator = await deployOperator(sharedContracts, operatorWallet)
            await expect(operator.connect(admin).setNodeAddresses([admin.address]))
                .to.be.revertedWith("error_onlyOperator")
            await expect(operator.connect(admin).updateNodeAddresses([], [admin.address]))
                .to.be.revertedWith("error_onlyOperator")
            await expect(operator.setNodeAddresses([admin.address]))
                .to.emit(operator, "NodesSet").withArgs([admin.address])
            await expect(operator.getNodeAddresses()).to.eventually.deep.equal([admin.address])
            await expect(operator.updateNodeAddresses([], [admin.address]))
                .to.emit(operator, "NodesSet").withArgs([])
            await expect(operator.getNodeAddresses()).to.eventually.deep.equal([])
        })

        it("can be set all at once (setNodeAddresses positive test)", async function(): Promise<void> {
            const operator = await deployOperator(sharedContracts, operatorWallet)
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
            const operator = await deployOperator(sharedContracts, operatorWallet)
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
            await setTokens(sponsor, "1000") // accounts 1, 2, 3
            await setTokens(operatorWallet, "1000")
            await setTokens(delegator, "1000")
            const {
                sponsorships: [ sponsorship ],
                operators: [ flagger, target, voter ]
            } = await setupSponsorships(sharedContracts, [3], this.test!.title, { sponsor: false })
            const start = await getBlockTimestamp()

            await advanceToTimestamp(start, "Flag starts")
            await (await flagger.setNodeAddresses([])).wait()
            await expect(flagger.flag(sponsorship.address, target.address))
                .to.be.revertedWith("error_onlyNodes")

            await (await flagger.setNodeAddresses([await flagger.owner()])).wait()
            await expect(flagger.flag(sponsorship.address, target.address))
                .to.emit(voter, "ReviewRequest").withArgs(sponsorship.address, target.address)

            await advanceToTimestamp(start + VOTE_START, "Voting starts")
            await (await voter.setNodeAddresses([])).wait()
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.be.revertedWith("error_onlyNodes")

            await (await voter.setNodeAddresses([await voter.owner()])).wait()
            await expect(voter.voteOnFlag(sponsorship.address, target.address, VOTE_KICK))
                .to.emit(target, "Unstaked").withArgs(sponsorship.address)
        })

        it("can call heartbeat", async function(): Promise<void> {
            const operator = await deployOperator(sharedContracts, operatorWallet)
            await expect(operator.heartbeat("{}")).to.be.rejectedWith("error_onlyNodes")
            await (await operator.setNodeAddresses([delegator2.address])).wait()
            await expect(operator.connect(delegator2).heartbeat("{}")).to.emit(operator, "Heartbeat").withArgs(delegator2.address, "{}")
        })
    })

    it("allows controllers to act on behalf of the operator", async function(): Promise<void> {
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await expect(operator.connect(controller).setNodeAddresses([controller.address])).to.be.revertedWith("error_onlyOperator")
        await (await operator.grantRole(await operator.CONTROLLER_ROLE(), controller.address)).wait()
        await operator.connect(controller).setNodeAddresses([controller.address])
    })

})
