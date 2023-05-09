import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { AddressZero } from "@ethersproject/constants"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"

import type { Operator, SponsorshipFactory, TestToken } from "../../network-contracts/typechain"
import { ContractFactory } from "@ethersproject/contracts"
import { abi as operatorAbi, bytecode as operatorBytecode } 
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Operator.sol/Operator.json"
import { abi as sponsorshipFactoryAbi, bytecode as sponsorshipFactoryBytecode } 
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json"
import { abi as tokenAbi, bytecode as tokenBytecode } 
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

describe("OperatorClient", async () => {
    const config = Chains.load()["dev1"]
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    // const sponsorshipAddress = "0x93B517f6014F930631Cb4AD4F7d329b453Bd87d9"
    const operatorAddress = "0xb7BFd245d932163b68e6796C8D08D022Bc391E9a"
    const operatorPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
    // const operatorPrivKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
    let operator: Operator
    let sponsorshipFactory: SponsorshipFactory
    let token: TestToken
    let operatorWallet: Wallet

    before(async () => {
        provider = new JsonRpcProvider(chainURL)

        operatorWallet = new Wallet(operatorPrivKey, provider)

        const  operatorFactory = new ContractFactory(operatorAbi, operatorBytecode, operatorWallet)
        operator = await operatorFactory.attach(operatorAddress) as unknown as Operator
        // eslint-disable-next-line require-atomic-updates
        operator = await operator.deployed() // checks for bytecode match

        const sponsorshipFactoryFactory = new ContractFactory(sponsorshipFactoryAbi, sponsorshipFactoryBytecode, operatorWallet)
        sponsorshipFactory = await sponsorshipFactoryFactory.attach(config.contracts.SponsorshipFactory) as unknown as SponsorshipFactory
        await sponsorshipFactory.deployed()

        const tokenFactory = new ContractFactory(tokenAbi, tokenBytecode, operatorWallet)
        token = await tokenFactory.attach(config.contracts.LINK) as unknown as TestToken
        await token.deployed()

        const operatorWalletBalance = await token.balanceOf(operatorWallet.address)
        log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

    })

    it("emits addStakedStream only when the first Sponsorship for a stream is staked to", async () => {
        const sponsorshiptx = await sponsorshipFactory.deploySponsorship(parseEther("60"), 0, 1, "Sponsorship-" + Date.now(), "metadata",
            [
                "0x699B4bE95614f017Bb622e427d3232837Cc814E6", // allocation policy
                AddressZero, // leavepolicy?
                "0x611900fD07BB133016Ed85553aF9586771da5ff9",  // vote kick policy
            ], [
                parseEther("0.01"),
                "0",
                "0"
            ]
        )
        const sponsorshipReceipt = await sponsorshiptx.wait()
        const newSponsorshipAddress = sponsorshipReceipt.events![0].address
        new OperatorClient(operatorAddress, provider)
        // await (await operator.approve(newSponsorshipAddress, parseEther("1"))).wait()
        const operatorPooltokenBalance = await operator.balanceOf(operatorWallet.address)
        log(`operatorPooltokenBalance ${operatorPooltokenBalance}`)
        await (await token.transferAndCall(operatorAddress, parseEther("1"), operatorWallet.address)).wait()
        const tr = await (await operator.stake(newSponsorshipAddress, parseEther("1"))).wait()
        log(tr)
    })

    it("emits removeStakedStream only when the last Sponsorship for a stream was unstaked from", () => {
        new OperatorClient(operatorAddress, provider)
    })
})
