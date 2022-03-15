// SPDX-License-Identifier: MIT

import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory } from 'ethers'
import { ERC20 } from '../typechain/ERC20'
import { IAllocationPolicy, IJoinPolicy, ILeavePolicy } from '../typechain'

// const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars

use(waffle.solidity)

describe('Bounty', (): void => {
    const wallets = provider.getWallets()
    const adminAddress = wallets[0].address
    const brokerAddress = wallets[8].address
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let bountyContract: Bounty
    let tokenAddress: string
    let token: ERC20
    let joinPolicy: IJoinPolicy
    let leavePolicy: ILeavePolicy
    let allocationPolicy: IAllocationPolicy

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', wallets[0])
        token = await tokenTxr.deploy() as ERC20
        tokenAddress = token.address
        // await token.mint(adminAddress, ethers.utils.parseEther('1000000'))

        const jpF = await ethers.getContractFactory('DefaultJoinPolicy', wallets[0])
        const jpTx = await jpF.deploy() as Contract
        joinPolicy = await jpTx.connect(wallets[0]).deployed() as IJoinPolicy

        const lpF = await ethers.getContractFactory('DefaultLeavePolicy', wallets[0])
        const lpTx = await lpF.deploy() as Contract
        leavePolicy = await lpTx.connect(wallets[0]).deployed() as ILeavePolicy

        const apF = await ethers.getContractFactory('WeightBasedAllocationPolicy', wallets[0])
        const apTx = await apF.deploy() as Contract
        allocationPolicy = await apTx.connect(wallets[0]).deployed() as IAllocationPolicy

        const agreementFactory = await ethers.getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallets[0])
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory, 
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    })

    it('deploy bounty through factory', async (): Promise<void> => {
        const bountyName = "test2"
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, 10, 1, 100, 
            joinPolicy.address, leavePolicy.address, allocationPolicy.address, bountyName)
        const res = await agreementtx.wait()
        // const newAgreement = await bountyFactoryFactory.interface.decodeEventLog('NewBounty', res.logs[0].data, res.logs[0].topics)
        // console.log(JSON.stringify(agreementtx))
        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        // console.log(JSON.stringify(res))
        const agreementFactory = await ethers.getContractFactory('Bounty')
        // bountyContract = agreementFactory.attach(newAgreement.bountyContract.toString())
        // const agreementDeployed = await bountyContract.deployed()
        // const agreement = (await bountyContract.connect(wallets[0]))
        // token.transferAndCall(agreement.address, ethers.utils.parseEther('1'), ...)
        bountyContract = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty
        // const txa = await agreement.callStatic.a();
        const txa = await bountyContract.a()
        // console.log(txa)
        console.log(await provider.getCode(bountyContract.address))
        // const txareceipt = await txa.wait()
        // console.log(txareceipt)

        let tx = await token.transfer(bountyContract.address, ethers.utils.parseEther('1'))
        await tx.wait()
        tx = await bountyContract.join(brokerAddress)
        await tx.wait()
        tx = await bountyContract.stake(brokerAddress, ethers.utils.parseEther('1'))
        await tx.wait()
        // console.log(await agreement.unallocatedWei())
    })

    it('bounty directly', async (): Promise<void> => {
        const agreementFactory = await ethers.getContractFactory('Bounty')
        const agreement = await agreementFactory.deploy()
        await agreement.deployed()
        await (await agreement.initialize(ethers.constants.AddressZero, 0, 0, 10, 1, 100, 
            joinPolicy.address, leavePolicy.address, allocationPolicy.address, ethers.constants.AddressZero)).wait()

        // bountyContract = agreementFactory.attach(newAgreement.bountyContract.toString())
        // const agreementDeployed = await bountyContract.deployed()
        // const agreement = (await bountyContract.connect(wallets[0]))
        // token.transferAndCall(agreement.address, ethers.utils.parseEther('1'), ...)
        // const agreement = new Contract(newAgreement.bountyContract.toString(), agreementFactory.interface, wallets[0])
        // const txa = await agreement.callStatic.a();
        const txa = await agreement.a()
        console.log(txa)
        // const txareceipt = await txa.wait()
        // console.log(txareceipt)

        // let tx = await token.transfer(agreement.address, ethers.utils.parseEther('1'))
        // await tx.wait()
        // tx = await agreement.join(brokerAddress)
        // await tx.wait()
        // tx = await agreement.stake(brokerAddress, ethers.utils.parseEther('1'))
        // await tx.wait()
        // console.log(await agreement.unallocatedWei())
    })
})
