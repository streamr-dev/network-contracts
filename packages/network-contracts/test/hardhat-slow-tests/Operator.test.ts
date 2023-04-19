import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { advanceToTimestamp, getBlockTimestamp } from "../hardhat/OperatorTokenomics/utils"
import { deployTestContracts, TestContracts } from "../hardhat/OperatorTokenomics/deployTestContracts"
import { deployOperator } from "../hardhat/OperatorTokenomics/deployOperatorContract"

import { deploySponsorship } from "../hardhat/OperatorTokenomics/deploySponsorshipContract"

const { parseEther } = utils
const { getSigners } = hardhatEthers

describe("Operator", (): void => {
    let admin: Wallet
    let operatorWallet: Wallet    // creates Operator contract
    let delegator: Wallet   // delegates DATA to Operator
    let sponsor: Wallet     // send DATA to a stream's Sponsorship contract

    let sharedContracts: TestContracts

    // burn all tokens then mint the corrent amount of new ones
    async function setTokens(account: Wallet, amount: string) {
        const { token } = sharedContracts
        const oldBalance = await token.balanceOf(account.address)
        await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
        if (amount !== "0") {
            await (await token.mint(account.address, parseEther(amount))).wait()
        }
    }

    before(async (): Promise<void> => {
        [admin, operatorWallet, delegator, sponsor] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)
    })

    it("edge case many queue entries, one sponsorship, batched", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")
        const timeAtStart = await getBlockTimestamp()

        const sponsorship = await deploySponsorship(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const operator = await deployOperator(sharedContracts, operatorWallet)
        await (await token.connect(delegator).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("1000"), "0x")).wait()

        await advanceToTimestamp(timeAtStart, "Stake to sponsorship and queue payouts")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        for (let i = 0; i < 1000; i++) {
            await operator.connect(delegator).undelegate(parseEther("1"))
        }
        expect(await operator.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("1000"))

        // doing it in one go with 1000 slots in the queue will fail...
        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from sponsorship")
        const gasLimit = 0xF42400 // "reasonable gas limit"
        await expect(operator.unstake(sponsorship.address, { gasLimit })).to.be.reverted

        // ...so do it in pieces
        await (await operator.unstakeWithoutQueue(sponsorship.address, { gasLimit })).wait()
        for (let i = 0; i < 1000; i += 10) {
            await (await operator.payOutQueueWithFreeFunds(10, { gasLimit })).wait()
        }

        // got everything back
        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("1000"))
    })

    it("edge case one queue entry, many sponsorships", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "100000")
        await setTokens(sponsor, "100000")
        const operator = await deployOperator(sharedContracts, operatorWallet)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to sponsorships and queue the payout")
        const numberOfSponsorships = 1000
        const totalStaked = parseEther("100").mul(numberOfSponsorships)
        const sponsorships = []
        for (let i = 0; i < numberOfSponsorships; i++) {
            const sponsorship = await deploySponsorship(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            await (await token.connect(delegator).transferAndCall(operator.address, parseEther("100"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(sponsorship.address, parseEther("100"), "0x")).wait()
            await (await operator.stake(sponsorship.address, parseEther("100"))).wait()
            sponsorships.push(sponsorship)
        }
        await operator.connect(delegator).undelegate(totalStaked)
        expect(await operator.totalQueuedPerDelegatorWei(delegator.address)).to.equal(totalStaked)
        expect(await operator.balanceOf(delegator.address)).to.equal(parseEther((numberOfSponsorships * 100).toString()))

        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from sponsorship")
        for (const sponsorship of sponsorships) {
            await (await operator.unstake(sponsorship.address)).wait()
        }

        // got everything back
        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("100000"))
    })
})
