import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, ContractTransaction, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"
import { deployBountyContract } from "../deployBounty"

const { parseEther, formatEther } = utils

describe("StakeWeightedAllocationPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet
    let broker3: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, broker, broker2, broker3] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
        await (await token.transfer(broker3.address, parseEther("100000"))).wait()
    })

    it("allocates correctly for single broker (positive test)", async () => {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("10000"))).wait()
        const balanceBefore = await token.balanceOf(broker.address)
        const timeAtStart = await getBlockTimestamp()

        // join tx actually happens at timeAtStart + 1
        await advanceToTimestamp(timeAtStart, "broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        const allocationAfterJoin = await bounty.getAllocation(broker.address)
        const stakeAfterJoin = await bounty.getStake(broker.address)

        await advanceToTimestamp(timeAtStart + 21, "broker leaves")
        const allocationAfter20 = await bounty.getAllocation(broker.address)

        await advanceToTimestamp(timeAtStart + 51, "broker leaves")
        const allocationAfter50 = await bounty.getAllocation(broker.address)

        await advanceToTimestamp(timeAtStart + 100, "broker leaves")
        // this getter happens at timeAtStart + 100
        // const allocationBeforeLeave = await bounty.getAllocation(broker.address)
        // but this tx happens at timeAtStart + 101...
        await (await bounty.connect(broker).unstake()).wait()
        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)

        // broker now has his stake back plus additional winnings
        expect(formatEther(allocationAfterJoin)).to.equal("0.0")
        expect(formatEther(allocationAfter20)).to.equal("20.0")
        expect(formatEther(allocationAfter50)).to.equal("50.0")
        // expect(formatEther(allocationBeforeLeave)).to.equal("100.0") // ...hence this will show 99 instead of 100
        expect(formatEther(balanceChange)).to.equal("100.0") // ...this however is correct because both tx are "1 second late"
        expect(formatEther(stakeAfterJoin)).to.equal("1000.0")
    })

    it("allocates correctly for two brokers, same weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : broker1 joins
        // t1 = t0 + 1000: broker2 joins
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + half-of-half = 75% of the winnings
        // broker2 should have half-of-half = 25% of the winnings
        const sponsorshipWei = parseEther("10000")
        const totalTokensExpected = parseEther("4000")

        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await token.transferAndCall(bounty.address, sponsorshipWei, "0x")).wait() // sponsor using ERC677
        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const unallocatedWeiBefore = await bounty.getUnallocatedWei() as BigNumber
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "broker1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "broker2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "broker2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "broker1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const unallocatedWeiAfter = await bounty.getUnallocatedWei() as BigNumber
        const tokensBroker1Expected = totalTokensExpected.div(4).mul(3)
        const tokensBroker2Expected = totalTokensExpected.div(4)

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
        expect(formatEther(unallocatedWeiBefore)).to.equal(formatEther(sponsorshipWei))
        expect(formatEther(unallocatedWeiAfter)).to.equal(formatEther(sponsorshipWei.sub(totalTokensExpected)))
    })

    it("allocates correctly for two brokers, different weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + 20% of half = 60% of the winnings
        // broker2 should have 80% of half = 40% of the winnings
        const totalTokensExpected = parseEther("4000")

        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("100000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("4"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(60)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(40)

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
    })

    it("allocates correctly for two brokers, different weight, with adding additional stake", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1 (1 : 0)
        // t = t0 + 2000: broker2 joins, stakes 1 (1 : 1)
        // t = t0 + 4000: broker1 adds 3 stake => (4 : 1)
        // t = t0 + 6000: broker2 adds 3 stake => (4 : 4)
        // t = t0 + 8000: broker2 leaves       => (4 : 0)
        // t = t0 +10000: broker1 leaves       => (0 : 0)
        // broker1 should have 2000 + 1000 + 1600 + 1000 + 2000 = 7600
        // broker2 should have        1000 +  400 + 1000        = 2400
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("10008"))).wait()
        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 adds stake 1 -> 4")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("3"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 6000, "Broker 2 adds stake 1 -> 4")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("3"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 8000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 10000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = parseEther("7600")
        const tokensBroker2Expected = parseEther("2400")

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
    })

    it("allocates correctly for one broker, adding stake", async function(): Promise<void> {
        //     t0       : broker joins, stakes 4
        // t = t0 + 1000: broker reduces 2 stake
        // t = t0 + 2000: broker leaves
        // broker should have 2000
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("10008"))).wait()
        const tokensBroker1Before = await token.balanceOf(broker.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("4"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 1 adds 1 stake 4 -> 5")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker1Expected = parseEther("2000")

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
    })

    it("allocates correctly for one broker, reducing stake", async function(): Promise<void> {
        //     t0       : broker joins, stakes 4
        // t = t0 + 1000: broker reduces 2 stake
        // t = t0 + 2000: broker leaves
        // broker should have 2000
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("10008"))).wait()
        const tokensBroker1Before = await token.balanceOf(broker.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("4"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 reduces 1 stake 4 -> 2")
        await (await bounty.connect(broker).reduceStakeTo(parseEther("2"))).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker1Expected = parseEther("2000")

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
    })

    it("allocates correctly for two brokers, different weight, reducing stake without slashing", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 6 (6 : 0)
        // t = t0 + 2000: broker2 joins, stakes 6 (6 : 6)
        // t = t0 + 4000: broker2 reduces 2 stake => (6 : 4)
        // t = t0 + 6000: broker1 reduces 2 stake => (4 : 4)
        // t = t0 + 8000: broker2 leaves       => (4 : 0)
        // t = t0 +10000: broker1 leaves       => (0 : 0)
        // broker1 should have 2000 + 1000 + 1200 + 1000 + 2000 = 7200
        // broker2 should have        1000 +  800 + 1000        = 2800
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("10008"))).wait()
        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("3"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("3"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 reduces stake 3 -> 1")
        await (await bounty.connect(broker2).reduceStakeTo(parseEther("1"))).wait()
        // await (await token.connect(broker).transferAndCall(bounty.address, parseEther("3"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 6000, "Broker 1 reduces stake 2 -> 1")
        await (await bounty.connect(broker).reduceStakeTo(parseEther("1"))).wait()
        // await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("3"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 8000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 10000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = parseEther("7499.999999999999994")
        const tokensBroker2Expected = parseEther("2499.999999999999996")

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
    })

    it("allocates correctly if money runs out", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t2 = t0 + 2000: money runs out
        // t3 = t0 + 3000: broker2 leaves
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are expected winnings i.e. owed to brokers
        //            but only half actually allocated and paid out
        // broker1 should have half * (half + 20% of half) = 30% of the expected winnings
        // broker2 should have half * (80% of half) = 20% of the expected winnings
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        const totalTokensExpected = parseEther("4000")
        await (await bounty.sponsor(totalTokensExpected.div(2))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(
            bounty.address,
            parseEther("1000"),
            broker.address
        )).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(
            bounty.address,
            parseEther("4000"),
            broker2.address
        ) as ContractTransaction).wait()

        // timeAtStart + 2001: money runs out (+1 because joins happen at +1)

        await advanceToTimestamp(timeAtStart + 3000, "Broker 2 leaves")
        const leave2Tr = await (await bounty.connect(broker2).unstake() as ContractTransaction).wait()
        const insolvencyEvent = leave2Tr.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake() as ContractTransaction).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(30)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(20)

        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
        expect(insolvencyEvent).to.not.be.undefined
    })

    it("allocates correctly if money runs out, and then money is added", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker2 leaves
        // t = t0 + 5000: broker1 leaves
        // in the end the expected winnings are 4000 tokens, because between 2000...3000 no allocations were paid
        // broker1 should have 1000 + 500 + 0 + 500 + 1000 = 3000 tokens
        // broker2 should have   0  + 500 + 0 + 500 +   0  = 1000 tokens
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = parseEther("3000")
        const tokensBroker2Expected = parseEther("1000")

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 2001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            // timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1000").div("2000").toString(),     // 2000 full token total stake
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensBroker1Actual)).to.equal(formatEther(tokensBroker1Expected))
        expect(formatEther(tokensBroker2Actual)).to.equal(formatEther(tokensBroker2Expected))
    })

    it("allocates correctly if broker joins during insolvency", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker2 joins, stakes 1000 tokens
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker1 leaves
        // t = t0 + 5000: broker2 leaves
        // seconds between 0...1000...2000...3000...4000...5000  total
        // broker1 gets     1000   + 0    + 0   + 500    + 0    = 1500
        // broker2 gets        0   + 0    + 0   + 500 + 1000    = 1500
        // defaulted tokens          1000 + 1000                = 2000
        // defaulted per stake       1    + 0.5                 = 1.5
        // this means: if there wouldn't have been insolvency:
        //   brokers would've gotten 2000 tokens more, i.e. 3000 + 2000 tokens
        //   broker1 would've gotten 1.5 more per stake, i.e. 1500 + 1.5*1000 tokens (since it was joined all through the insolvency)
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("1000"))).wait()
        await (await token.connect(broker2).approve(bounty.address, parseEther("100000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker 2 joins")
        const tr = await (await bounty.connect(broker2).stake(broker2.address, parseEther("1000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr2 = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")

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

    it("allocates correctly if broker leaves during insolvency", async function(): Promise<void> {
        //     t0       : broker joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker leaves
        // expecting to get 1000 tokens and defaulting 1000
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker leaves")
        const leaveTr = await (await bounty.connect(broker).unstake()).wait()
        const insolvencyEvent = leaveTr.events?.find((e) => e.event == "InsolvencyStarted")

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

        // event InsolvencyStarted(uint startTimeStamp);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(formatEther(newTokens)).to.equal("1000.0")
    })

    it("allocates correctly if the ONLY broker joins and leaves during insolvency", async function(): Promise<void> {
        // t = t0       : broker joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker leaves
        // t = t0 + 3000: broker joins
        // t = t0 + 4000: money added
        // t = t0 + 5000: broker leaves
        // time between 0...1000...2000...3000...4000...5000  total
        // broker gets   1000  + 0    + 0   +  0  + 1000    = 2000
        // defaulted       0 + 1000   + 0  + 1000 +   0     = 2000
        // tokens should NOT be counted as defaulted when the bounty isn't running (between 2000...3000)
        //   (although defaulted tokens can't be read from anywhere because broker didn't stay through insolvency!)
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker leaves")
        const tr1 = await (await bounty.connect(broker).unstake()).wait()
        const insolvencyStartEvent = tr1.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Broker joins again")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Money is added")
        const tr2 = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 5000, "Broker leaves")
        await (await bounty.connect(broker).unstake()).wait()

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

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

    it("allocates correctly if a broker leaves then joins during insolvency", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker1 joins, stakes 1000 tokens
        // t = t0 + 5000: money is added
        // t = t0 + 6000: broker1 leaves
        // t = t0 + 7000: broker2 leaves
        // seconds between 0...1000...2000...3000...4000...5000...6000...7000  total
        // broker1 gets     1000 + 500 +   0  +   0  +   0  +  500 +    0     = 2000
        // broker2 gets        0 + 500 +   0  +   0  +   0  +  500 + 1000     = 2000
        // defaulted tokens             1000 + 1000  + 1000                   = 3000
        // defaulted per stake           0.5 +  1.0  + 0.5                    = 2.0
        // this means: if there wouldn't have been insolvency:
        //   brokers would've gotten 3000 tokens more, i.e. 4000 + 3000 tokens
        //   broker2 would've gotten 2.0 more per stake, i.e. 2000 + 2.0*1000 tokens (since it was joined all through the insolvency)
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        const tr1 = await (await bounty.connect(broker).unstake()).wait()
        const insolvencyStartEvent = tr1.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 joins again")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Money is added")
        const tr2 = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEndEvent = tr2.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 6000, "Broker 1 leaves again")
        await (await bounty.connect(broker).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 7000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 2001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 5001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("2.0").toString(),
            parseEther("3000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("2000.0")
        expect(formatEther(tokensBroker2)).to.equal("2000.0")
    })

    it("allocates correctly if money runs out exactly during join", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins while money runs out
        // t = t0 + 2000: money is added
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker2 leaves
        // broker1 should get 1000 +  500 tokens
        // broker2 should get    0 + 1500 tokens
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out AND broker2 joins
        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("0.5").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during leave", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND broker1 leaves
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker2 leaves
        // broker1 should have 1000 + 500 tokens
        // broker2 should have 500 + 1000 tokens
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out AND broker leaves
        await advanceToTimestamp(timeAtStart + 2000, "Broker 1 leaves")
        await (await bounty.connect(broker).unstake()).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyStartEvent = tr.events?.find((e) => e.event == "InsolvencyStarted")
        const insolvencyEndEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyStarted(uint startTimeStamp);
        // event InsolvencyEnded(uint endTimeStamp, uint defaultedWeiPerStake, uint defaultedWei);
        expect(insolvencyStartEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 2001])
        expect(insolvencyEndEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 3001).toString(), // +1 because all tx happen one second "late" in test env
            parseEther("1.0").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during top-up (and emits no insolvency event)", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND money is added
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker2 leaves
        // broker1 should have 1000 + 500 + 500 +    0 = 2000 tokens
        // broker2 should have    0 + 500 + 500 + 1000 = 2000 tokens
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)
        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        const tr2 = await (await bounty.connect(broker).unstake()).wait()
        const insolvencyEvent2 = tr2.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).unstake()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        expect(insolvencyEvent).to.be.undefined
        expect(insolvencyEvent2).to.be.undefined
        expect(formatEther(tokensBroker1)).to.equal("2000.0")
        expect(formatEther(tokensBroker2)).to.equal("2000.0")
    })

    it("allocates correctly when number of brokers is below minBrokerCount at times", async function(): Promise<void> {
        // TODO
    })

    it("gets allocation 0 from unjoined broker", async function(): Promise<void> {
        const bounty = await deployBountyContract(contracts)
        const allocation = await bounty.getAllocation(broker.address)
        expect(allocation.toString()).to.equal("0")
    })
})
