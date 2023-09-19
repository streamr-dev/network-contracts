import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, ContractTransaction, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"
import { deploySponsorshipWithoutFactory } from "../deploySponsorshipContract"

const { parseEther, formatEther } = utils

describe.only("StakeWeightedAllocationPolicy", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet
    let operator3: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, operator, operator2, operator3] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(operator.address, parseEther("100000"))).wait()
        await (await token.transfer(operator2.address, parseEther("100000"))).wait()
        await (await token.transfer(operator3.address, parseEther("100000"))).wait()
    })

    it("allocates correctly for single operator (positive test)", async () => {
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const balanceBefore = await token.balanceOf(operator.address)
        const timeAtStart = await getBlockTimestamp()

        // join tx actually happens at timeAtStart + 1
        await advanceToTimestamp(timeAtStart, "operator joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()
        const allocationAfterJoin = await sponsorship.getEarnings(operator.address)
        const stakeAfterJoin = await sponsorship.stakedWei(operator.address)

        await advanceToTimestamp(timeAtStart + 21, "operator leaves")
        const allocationAfter20 = await sponsorship.getEarnings(operator.address)

        await advanceToTimestamp(timeAtStart + 51, "operator leaves")
        const allocationAfter50 = await sponsorship.getEarnings(operator.address)

        await advanceToTimestamp(timeAtStart + 100, "operator leaves")
        // this getter happens at timeAtStart + 100
        // const allocationBeforeLeave = await sponsorship.getEarnings(operator.address)
        // but this tx happens at timeAtStart + 101...
        await (await sponsorship.connect(operator).unstake()).wait()
        const balanceChange = (await token.balanceOf(operator.address)).sub(balanceBefore)

        // operator now has his stake back plus additional earnings
        expect(formatEther(allocationAfterJoin)).to.equal("0.0")
        expect(formatEther(allocationAfter20)).to.equal("20.0")
        expect(formatEther(allocationAfter50)).to.equal("50.0")
        // expect(formatEther(allocationBeforeLeave)).to.equal("100.0") // ...hence this will show 99 instead of 100
        expect(formatEther(balanceChange)).to.equal("100.0") // ...this however is correct because both tx are "1 second late"
        expect(formatEther(stakeAfterJoin)).to.equal("1000.0")
    })

    it("allocates correctly for two operators, same weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : operator1 joins
        // t1 = t0 + 1000: operator2 joins
        // t3 = t0 + 3000: operator2 leaves (stayed for half the time)
        // t4 = t0 + 4000: operator1 leaves
        // in the end 4000*(wei/sec) are total earnings allocated
        // operator1 should have half + half-of-half = 3/4 of the earnings = 4000 * 4/3 = 3000
        // operator2 should have half-of-half = 1/4 of the earnings = 4000 * 1/4 = 1000
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await token.transferAndCall(sponsorship.address, parseEther("10000"), "0x")).wait() // sponsor using ERC677
        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const remainingWeiBefore = await sponsorship.remainingWei()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "operator1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "operator2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("100"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "operator2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "operator1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const newTokens1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const newTokens2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)
        const remainingWeiAfter = await sponsorship.remainingWei()

        expect(formatEther(newTokens1)).to.equal("3000.0")
        expect(formatEther(newTokens2)).to.equal("1000.0")
        expect(formatEther(remainingWeiBefore)).to.equal("10000.0")
        expect(formatEther(remainingWeiAfter)).to.equal("6000.0")
    })

    it("allocates correctly for two operators, different weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : operator1 joins, stakes 100
        // t1 = t0 + 1000: operator2 joins, stakes 400
        // t3 = t0 + 3000: operator2 leaves (stayed for half the time)
        // t4 = t0 + 4000: operator1 leaves
        // in the end 4000*(wei/sec) are earnings
        // operator1 should have half + 20% of half = 60% of the earnings
        // operator2 should have 80% of half = 40% of the earnings
        const totalTokensExpected = parseEther("4000")

        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("100000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("400"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const tokensOperator1Actual = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2Actual = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)
        const tokensOperator1Expected = totalTokensExpected.div(100).mul(60)
        const tokensOperator2Expected = totalTokensExpected.div(100).mul(40)

        expect(formatEther(tokensOperator1Actual)).to.equal(formatEther(tokensOperator1Expected))
        expect(formatEther(tokensOperator2Actual)).to.equal(formatEther(tokensOperator2Expected))
    })

    it("allocates correctly for two operators, different weight, with adding additional stake", async function(): Promise<void> {
        //     t0       : operator1 joins, stakes 100 (1 : 0)
        // t = t0 + 2000: operator2 joins, stakes 100 (1 : 1)
        // t = t0 + 4000: operator1 adds 300 stake => (4 : 1)
        // t = t0 + 6000: operator2 adds 300 stake => (4 : 4)
        // t = t0 + 8000: operator2 leaves         => (4 : 0)
        // t = t0 +10000: operator1 leaves         => (0 : 0)
        // operator1 should have 2000 + 1000 + 1600 + 1000 + 2000 = 7600
        // operator2 should have        1000 +  400 + 1000        = 2400
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("10008"))).wait()
        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("100"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Operator 1 adds stake 100 -> 400")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("300"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 6000, "Operator 2 adds stake 100 -> 400")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("300"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 8000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 10000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const newTokens1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const newTokens2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        expect(formatEther(newTokens1)).to.equal("7600.0")
        expect(formatEther(newTokens2)).to.equal("2400.0")
    })

    it("allocates correctly for one operator, adding stake", async function(): Promise<void> {
        //     t0       : operator joins, stakes 400
        // t = t0 + 1000: operator adds 100 stake 400 -> 500
        // t = t0 + 2000: operator leaves
        // operator should have 2000
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("12345"))).wait()
        const tokensOperator1Before = await token.balanceOf(operator.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator joins")
        await expect(token.connect(operator).transferAndCall(sponsorship.address, parseEther("400"), operator.address))
            .to.emit(sponsorship, "StakeUpdate").withArgs(operator.address, parseEther("400"), parseEther("0"))
            .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("400"), parseEther("12345"), 1, true)

        await advanceToTimestamp(timeAtStart + 1000, "Operator adds 100 stake 400 -> 500")
        await expect(token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address))
            .to.emit(sponsorship, "StakeUpdate").withArgs(operator.address, parseEther("500"), parseEther("1000"))
            .to.emit(sponsorship, "SponsorshipUpdate").withArgs(parseEther("500"), parseEther("11345"), 1, true)

        await advanceToTimestamp(timeAtStart + 2000, "Operator leaves")
        await expect(sponsorship.connect(operator).unstake())
            .to.emit(sponsorship, "OperatorLeft").withArgs(operator.address, parseEther("500"))

        const newTokens = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        expect(formatEther(newTokens)).to.equal("2000.0")
    })

    it("allocates correctly for one operator, reducing stake", async function(): Promise<void> {
        //     t0       : operator joins, stakes 400
        // t = t0 + 1000: operator reduces 200 stake
        // t = t0 + 2000: operator leaves
        // operator should have 2000
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("12345"))).wait()
        const tokensOperator1Before = await token.balanceOf(operator.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator joins, stakes 400")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("400"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator reduces stake 400 -> 200")
        await (await sponsorship.connect(operator).reduceStakeTo(parseEther("200"))).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Operator leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const newTokens = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)

        expect(formatEther(newTokens)).to.equal("2000.0")
    })

    it("allocates correctly for two operators, different weight, reducing stake without slashing", async function(): Promise<void> {
        //     t0        : operator1 joins, stakes 6 (6 : 0)
        // t = t0 +  3000: operator2 joins, stakes 6 (6 : 6)
        // t = t0 +  6000: operator2 stake -> 4      (6 : 4)
        // t = t0 +  8000: operator1 stake -> 4      (4 : 4)
        // t = t0 + 10000: operator2 leaves          (4 : 0)
        // t = t0 + 12000: operator1 leaves          (0 : 0)
        // operator1 should have 3000 + 1500 + 1200 + 1000 + 2000 = 8700
        // operator2 should have        1500 +  800 + 1000        = 3300
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("20000"))).wait()
        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("600"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("600"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 6000, "Operator 2 reduces stake 600 -> 400")
        await (await sponsorship.connect(operator2).reduceStakeTo(parseEther("400"))).wait()

        await advanceToTimestamp(timeAtStart + 8000, "Operator 1 reduces stake 600 -> 400")
        await (await sponsorship.connect(operator).reduceStakeTo(parseEther("400"))).wait()

        await advanceToTimestamp(timeAtStart + 10000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 12000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const newTokens1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const newTokens2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        expect(formatEther(newTokens1)).to.equal("8700.0")
        expect(formatEther(newTokens2)).to.equal("3300.0")
    })

    it("allocates correctly if money runs out", async function(): Promise<void> {
        //      t0       : operator1 joins, stakes 1
        // t1 = t0 + 1000: operator2 joins, stakes 4
        // t2 = t0 + 2000: money runs out
        // t3 = t0 + 3000: operator2 leaves
        // t4 = t0 + 4000: operator1 leaves
        // in the end 4000*(wei/sec) are expected earnings i.e. owed to operators
        //            but only half actually allocated and paid out
        // operator1 should have half * (half + 20% of half) = 30% of the expected earnings
        // operator2 should have half * (80% of half) = 20% of the expected earnings
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        const totalTokensExpected = parseEther("4000")
        await (await sponsorship.sponsor(totalTokensExpected.div(2))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(
            sponsorship.address,
            parseEther("1000"),
            operator.address
        )).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(
            sponsorship.address,
            parseEther("4000"),
            operator2.address
        ) as ContractTransaction).wait()

        // timeAtStart + 2001: money runs out (+1 because joins happen at +1)

        await advanceToTimestamp(timeAtStart + 3000, "Operator 2 leaves")
        const leave2Tr = await (await sponsorship.connect(operator2).unstake() as ContractTransaction).wait()
        const insolvencyEvent = leave2Tr.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake() as ContractTransaction).wait()

        const tokensOperator1Actual = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2Actual = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)
        const tokensOperator1Expected = totalTokensExpected.div(100).mul(30)
        const tokensOperator2Expected = totalTokensExpected.div(100).mul(20)

        expect(formatEther(tokensOperator1Actual)).to.equal(formatEther(tokensOperator1Expected))
        expect(formatEther(tokensOperator2Actual)).to.equal(formatEther(tokensOperator2Expected))
        expect(insolvencyEvent).to.not.be.undefined
    })

    it("allocates correctly if money runs out, and then money is added", async function(): Promise<void> {
        //     t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: operator2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out
        // t = t0 + 3000: money is added
        // t = t0 + 4000: operator2 leaves
        // t = t0 + 5000: operator1 leaves
        // in the end the expected earnings are 4000 tokens, because between 2000...3000 no allocations were paid
        // operator1 should have 1000 + 500 + 0 + 500 + 1000 = 3000 tokens
        // operator2 should have   0  + 500 + 0 + 500 +   0  = 1000 tokens
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("2000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")
        const insolvencyStartTime = ((insolvencyStartEvent?.args?.[0]) as BigNumber).toNumber()

        await advanceToTimestamp(timeAtStart + 4000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const tokensOperator1Actual = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2Actual = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)
        const tokensOperator1Expected = parseEther("3000")
        const tokensOperator2Expected = parseEther("1000")

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartTime - timeAtStart).to.equal(2001)
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            // timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1000").div("2000").toString(),     // 2000 full token total stake
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensOperator1Actual)).to.equal(formatEther(tokensOperator1Expected))
        expect(formatEther(tokensOperator2Actual)).to.equal(formatEther(tokensOperator2Expected))
    })

    it("allocates correctly if operator joins during insolvency", async function(): Promise<void> {
        // t = t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: operator2 joins, stakes 1000 tokens
        // t = t0 + 3000: money is added
        // t = t0 + 4000: operator1 leaves
        // t = t0 + 5000: operator2 leaves
        // seconds between 0...1000...2000...3000...4000...5000  total
        // operator1 gets     1000   + 0    + 0   + 500    + 0    = 1500
        // operator2 gets        0   + 0    + 0   + 500 + 1000    = 1500
        // defaulted tokens          1000 + 1000                = 2000
        // defaulted per stake       1    + 0.5                 = 1.5
        // this means: if there wouldn't have been insolvency:
        //   operators would've gotten 2000 tokens more, i.e. 3000 + 2000 tokens
        //   operator1 would've gotten 1.5 more per stake, i.e. 1500 + 1.5*1000 tokens (since it was joined all through the insolvency)
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("1000"))).wait()
        await (await token.connect(operator2).approve(sponsorship.address, parseEther("100000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Operator 2 joins")
        const tr = await (await sponsorship.connect(operator2).stake(operator2.address, parseEther("1000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr2 = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        const tokensOperator1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        expect(formatEther(tokensOperator1)).to.equal("1500.0")
        expect(formatEther(tokensOperator2)).to.equal("1500.0")

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            // (timeAtStart + 1001).toString(),
            (timeAtStart + 3001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("1.5").toString(),
            parseEther("2000").toString()
        ])
    })

    it("allocates correctly if operator leaves during insolvency", async function(): Promise<void> {
        //     t0       : operator joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: operator leaves
        // expecting to get 1000 tokens and defaulting 1000
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(operator.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Operator leaves")
        const leaveTr = await (await sponsorship.connect(operator).unstake()).wait()
        const insolvencyEvent = leaveTr.events?.find((e) => e.event == "InsolvencyStarted")

        const newTokens = (await token.balanceOf(operator.address)).sub(tokensBefore)

        // event InsolvencyStarted(uint startTimeStamp);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(formatEther(newTokens)).to.equal("1000.0")
    })

    it("allocates correctly if the ONLY operator joins and leaves during insolvency", async function(): Promise<void> {
        // t = t0       : operator joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: operator leaves
        // t = t0 + 3000: operator joins
        // t = t0 + 4000: money added
        // t = t0 + 5000: operator leaves
        // time between 0...1000...2000...3000...4000...5000  total
        // operator gets   1000  + 0    + 0   +  0  + 1000    = 2000
        // defaulted       0 + 1000   + 0  + 1000 +   0     = 2000
        // tokens should NOT be counted as defaulted when the sponsorship isn't running (between 2000...3000)
        //   (although defaulted tokens can't be read from anywhere because operator didn't stay through insolvency!)
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(operator.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Operator leaves")
        const tr1 = await (await sponsorship.connect(operator).unstake()).wait()
        const insolvencyStartEvent = tr1.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Operator joins again")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Money is added")
        const tr2 = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 5000, "Operator leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        const newTokens = (await token.balanceOf(operator.address)).sub(tokensBefore)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            // (timeAtStart + 1001).toString(),
            (timeAtStart + 4001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("2").toString(),
            parseEther("2000").toString()
        ])
        expect(formatEther(newTokens)).to.equal("2000.0")
    })

    it("allocates correctly if an operator leaves then joins during insolvency", async function(): Promise<void> {
        // t = t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: operator2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out
        // t = t0 + 3000: operator1 leaves
        // t = t0 + 4000: operator1 joins, stakes 1000 tokens
        // t = t0 + 5000: money is added
        // t = t0 + 6000: operator1 leaves
        // t = t0 + 7000: operator2 leaves
        // seconds between 0...1000...2000...3000...4000...5000...6000...7000  total
        // operator1 gets     1000 + 500 +   0  +   0  +   0  +  500 +    0     = 2000
        // operator2 gets        0 + 500 +   0  +   0  +   0  +  500 + 1000     = 2000
        // defaulted tokens             1000 + 1000  + 1000                   = 3000
        // defaulted per stake           0.5 +  1.0  + 0.5                    = 2.0
        // this means: if there wouldn't have been insolvency:
        //   operators would've gotten 3000 tokens more, i.e. 4000 + 3000 tokens
        //   operator2 would've gotten 2.0 more per stake, i.e. 2000 + 2.0*1000 tokens (since it was joined all through the insolvency)
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("2000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Operator 1 leaves")
        const tr1 = await (await sponsorship.connect(operator).unstake()).wait()
        const insolvencyStartEvent = tr1.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Operator 1 joins again")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Money is added")
        const tr2 = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 6000, "Operator 1 leaves again")
        await (await sponsorship.connect(operator).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 7000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        const tokensOperator1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 2001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 5001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("2.0").toString(),
            parseEther("3000").toString()
        ])
        expect(formatEther(tokensOperator1)).to.equal("2000.0")
        expect(formatEther(tokensOperator2)).to.equal("2000.0")
    })

    it("allocates correctly if money runs out exactly during join", async function(): Promise<void> {
        // t = t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: operator2 joins while money runs out
        // t = t0 + 2000: money is added
        // t = t0 + 3000: operator1 leaves
        // t = t0 + 4000: operator2 leaves
        // operator1 should get 1000 +  500 tokens
        // operator2 should get    0 + 1500 tokens
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("1000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        // timeAtStart + 1001: money runs out AND operator2 joins
        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 3000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        const tokensOperator1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("0.5").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensOperator1)).to.equal("1500.0")
        expect(formatEther(tokensOperator2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during leave", async function(): Promise<void> {
        //     t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: operator2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND operator1 leaves
        // t = t0 + 3000: money is added
        // t = t0 + 4000: operator2 leaves
        // operator1 should have 1000 + 500 tokens
        // operator2 should have 500 + 1000 tokens
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("2000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()

        // timeAtStart + 2001: money runs out AND operator leaves
        await advanceToTimestamp(timeAtStart + 2000, "Operator 1 leaves")
        await (await sponsorship.connect(operator).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        const tokensOperator1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 2001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 3001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("1.0").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensOperator1)).to.equal("1500.0")
        expect(formatEther(tokensOperator2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during top-up (and emits no insolvency event)", async function(): Promise<void> {
        //     t0       : operator1 joins, stakes 1000 tokens
        // t = t0 + 1000: operator2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND money is added
        // t = t0 + 3000: operator1 leaves
        // t = t0 + 4000: operator2 leaves
        // operator1 should have 1000 + 500 + 500 +    0 = 2000 tokens
        // operator2 should have    0 + 500 + 500 + 1000 = 2000 tokens
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        await (await sponsorship.sponsor(parseEther("2000"))).wait()

        const tokensOperator1Before = await token.balanceOf(operator.address)
        const tokensOperator2Before = await token.balanceOf(operator2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Operator 1 joins")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Operator 2 joins")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)
        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await sponsorship.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Operator 1 leaves")
        const tr2 = await (await sponsorship.connect(operator).unstake()).wait()
        const insolvencyEvent2 = tr2.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Operator 2 leaves")
        await (await sponsorship.connect(operator2).unstake()).wait()

        const tokensOperator1 = (await token.balanceOf(operator.address)).sub(tokensOperator1Before)
        const tokensOperator2 = (await token.balanceOf(operator2.address)).sub(tokensOperator2Before)

        expect(insolvencyEvent).to.be.undefined
        expect(insolvencyEvent2).to.be.undefined
        expect(formatEther(tokensOperator1)).to.equal("2000.0")
        expect(formatEther(tokensOperator2)).to.equal("2000.0")
    })

    it("allocates correctly when number of operators is below minOperatorCount at times", async function(): Promise<void> {
        // TODO
    })

    it("gets allocation 0 from unjoined operator", async function(): Promise<void> {
        const sponsorship = await deploySponsorshipWithoutFactory(contracts)
        const allocation = await sponsorship.getEarnings(operator.address)
        expect(allocation.toString()).to.equal("0")
    })
})
