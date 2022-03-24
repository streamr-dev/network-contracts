// SPDX-License-Identifier: MIT

import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory } from 'ethers'
import { ERC677 } from '../typechain/ERC677'
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
    let bounty: Bounty
    let tokenAddress: string
    let token: ERC677
    let joinPolicy: IJoinPolicy
    let leavePolicy: ILeavePolicy
    let allocationPolicy: IAllocationPolicy

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', wallets[0])
        token = await tokenTxr.deploy() as ERC677
        tokenAddress = token.address
        // await token.mint(adminAddress, ethers.utils.parseEther('1000000'))

        const jpF = await ethers.getContractFactory('MinimumStakeJoinPolicy', wallets[0])
        const jpTx = await jpF.deploy() as Contract
        joinPolicy = await jpTx.connect(wallets[0]).deployed() as IJoinPolicy

        // const lpF = await ethers.getContractFactory('DefaultLeavePolicy', wallets[0])
        // const lpTx = await lpF.deploy() as Contract
        // leavePolicy = await lpTx.connect(wallets[0]).deployed() as ILeavePolicy

        // const apF = await ethers.getContractFactory('WeightBasedAllocationPolicy', wallets[0])
        // const apTx = await apF.deploy() as Contract
        // allocationPolicy = await apTx.connect(wallets[0]).deployed() as IAllocationPolicy

        const agreementFactory = await ethers.getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallets[0])
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory, 
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    })

    it.only('deploy bounty through factory', async (): Promise<void> => {
        const bountyName = "test2"
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty1")
        const res = await agreementtx.wait()
        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        const agreementFactory = await ethers.getContractFactory('Bounty')
        bounty = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty
        // console.log(await bounty.unallocatedWei())
        const addpolicytx = await bounty.addJoinPolicy(joinPolicy.address, ethers.BigNumber.from('2000000000000000000'))
        const addpolicyres = await addpolicytx.wait()
        // let tx = await token.transfer(bounty.address, ethers.utils.parseEther('1'))
        // await tx.wait()
        // tx = await bounty.join(brokerAddress)
        // await tx.wait()
        // tx = await bounty.stake(brokerAddress, ethers.utils.parseEther('1'))
        // await tx.wait()
        // console.log(await bounty.unallocatedWei())
        let tx = await token.transferAndCall(bounty.address, ethers.utils.parseEther('2'), "0x")
        await tx.wait()
    })
})
