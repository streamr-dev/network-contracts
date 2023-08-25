import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { advanceToTimestamp, getBlockTimestamp, log } from "../hardhat/OperatorTokenomics/utils"
import { deployTestContracts } from "../hardhat/OperatorTokenomics/deployTestContracts"
import { deployOperatorContract } from "../hardhat/OperatorTokenomics/deployOperatorContract"

import { deploySponsorship } from "../hardhat/OperatorTokenomics/deploySponsorshipContract"
import { TestToken } from "../../typechain"

const { parseEther, formatEther } = utils
const { getSigners } = hardhatEthers

describe("Operator", (): void => {
    let admin: Wallet
    let operatorWallet: Wallet  // creates Operator contract

    // burn all tokens then mint the corrent amount of new ones
    async function setTokens(token: TestToken, account: Wallet, amount: string) {
        const oldBalance = await token.balanceOf(account.address)
        await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
        if (amount !== "0") {
            await (await token.mint(account.address, parseEther(amount))).wait()
        }
    }

    before(async (): Promise<void> => {
        [admin, operatorWallet] = await getSigners() as unknown as Wallet[]
    })

    it("edge case many queue entries, one sponsorship, batched", async function(): Promise<void> {
        const contracts = await deployTestContracts(admin)
        const { token, streamrConfig } = contracts
        await (await streamrConfig.setMinimumSelfDelegationFraction("0")).wait()
        await setTokens(token, operatorWallet, "1000")
        const timeAtStart = await getBlockTimestamp()

        const sponsorship = await deploySponsorship(contracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const operator = await deployOperatorContract(contracts, operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, parseEther("1000"), "0x")).wait()

        await advanceToTimestamp(timeAtStart, "Stake to sponsorship and queue payouts")
        await expect(operator.stake(sponsorship.address, parseEther("1000")))
            .to.emit(operator, "Staked").withArgs(sponsorship.address)

        const queueLength = 1000
        for (let i = 0; i < queueLength; i++) {
            if (i % 10 === 0) { log("undelegate %d / %d", i, queueLength) }
            await operator.undelegate(parseEther("1"))
        }

        // doing it in one go with 1000 slots in the queue will fail...
        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from sponsorship")

        // "reasonable gas limit" that is enough for await payOutQueueWithFreeFunds(10) which needs 486278 gas
        const gasLimit = 600000
        // log("gas: %s", (await operator.estimateGas.unstake(sponsorship.address)).toString())
        await expect(operator.unstake(sponsorship.address, { gasLimit })).to.be.reverted

        // ...so do it in pieces
        log("unstakeWithoutQueue, gas limit %s", gasLimit.toString())
        await (await operator.unstakeWithoutQueue(sponsorship.address, { gasLimit })).wait()
        for (let i = 0; i < queueLength; i += 10) {
            log("payOutQueueWithFreeFunds %d / %d", i, queueLength)
            await (await operator.payOutQueueWithFreeFunds(10, { gasLimit })).wait()
        }

        // got everything back
        const balanceAfter = await token.balanceOf(operatorWallet.address)
        expect(formatEther(balanceAfter)).to.equal("1000.0")
    })

    it("edge case one queue entry, many sponsorships", async function(): Promise<void> {
        const numberOfSponsorships = 1000
        const totalTokens = (100 * numberOfSponsorships).toString()
        const totalWei = parseEther(totalTokens)

        const contracts = await deployTestContracts(admin)
        const { token, streamrConfig } = contracts
        await (await streamrConfig.setMinimumSelfDelegationFraction("0")).wait()
        await setTokens(token, operatorWallet, totalTokens)
        const operator = await deployOperatorContract(contracts, operatorWallet)
        await (await token.connect(operatorWallet).transferAndCall(operator.address, totalWei, "0x")).wait()
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to sponsorships and queue the payout")
        const totalStaked = parseEther("100").mul(numberOfSponsorships)
        const sponsorships = []
        for (let i = 0; i < numberOfSponsorships; i++) {
            if (i % 10 === 0) { log("deploySponsorship & stake %d / %d", i, numberOfSponsorships) }
            const sponsorship = await deploySponsorship(contracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            await (await operator.stake(sponsorship.address, parseEther("100"))).wait()
            sponsorships.push(sponsorship)
        }
        await operator.undelegate(totalStaked)
        expect(await operator.balanceOf(operatorWallet.address)).to.equal(totalWei)

        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from sponsorship")
        for (let i = 0; i < numberOfSponsorships; i++) {
            if (i % 10 === 0) { log("unstake %d / %d", i, numberOfSponsorships) }
            await (await operator.unstake(sponsorships[i].address)).wait()
        }

        // got everything back
        const balanceAfter = await token.balanceOf(operatorWallet.address)
        expect(balanceAfter).to.equal(totalWei)
    })
})
