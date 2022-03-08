// SPDX-License-Identifier: MIT

import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory } from 'ethers'
import { ERC20 } from '../typechain/ERC20'

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

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', wallets[0])
        token = await tokenTxr.deploy() as ERC20
        tokenAddress = token.address
        // await token.mint(adminAddress, ethers.utils.parseEther('1000000'))

        bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallets[0])
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory, [ trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    })

    it.only('deploy bounty through factory', async (): Promise<void> => {
        const agreementtx = await bountyFactory.deployBountyAgreement()
        const res = await agreementtx.wait()
        expect(agreementtx).to.be.not.null
        // console.log(JSON.stringify(agreementtx))
        // console.log(JSON.stringify(res))
        const agreementFactory = await ethers.getContractFactory('Bounty', wallets[0])
        const newAgreement = await bountyFactoryFactory.interface.decodeEventLog('NewBounty', res.logs[0].data, res.logs[0].topics)
        bountyContract = agreementFactory.attach(newAgreement.bountyContract.toString()) as Bounty
        const agreementDeployed = await bountyContract.deployed()
        const agreement: Bounty = (await agreementDeployed.connect(wallets[0])) as Bounty
        // token.transferAndCall(agreement.address, ethers.utils.parseEther('1'), ...)
        await token.transfer(agreement.address, ethers.utils.parseEther('1'))
        await agreement.join(brokerAddress)
        await agreement.stake(brokerAddress, ethers.utils.parseEther('1'))
    })

})
