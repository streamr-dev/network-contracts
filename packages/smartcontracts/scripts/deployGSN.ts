// scripts/deploy.js
import { Wallet } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { WhitelistPaymaster } from '../typechain'
import { Forwarder } from '../typechain/Forwarder'

import { StreamRegistryV4 } from '../typechain/StreamRegistryV4'

const log = console.log
// const FORWARDER = "0xdA78a11FD57aF7be2eDD804840eA7f4c2A38801d"

async function main() {
    // const forwaderFactory = await ethers.getContractFactory('Forwarder')
    // log('Deploying Forwarder...')
    // const forwarder = await forwaderFactory.deploy() as Forwarder
    // await forwarder.deployed()
    // log('Forwarder deployed to:', forwarder.address)

    // // const relayhubFactory = await ethers.getContractFactory('RelayHub')
    // // log('Deploying Relayhub...')
    // // const relayHub = await relayhubFactory.deploy() as Contract
    // // log('Relayhub deployed to:', relayHub.address)

    const paymasterFactory = await ethers.getContractFactory('WhitelistPaymaster')
    log('Deploying Paymaster...')
    const paymaster = await paymasterFactory.deploy() as WhitelistPaymaster
    await paymaster.deployed()
    log('Paymaster deployed to:', paymaster.address)

    // const streamRegistryFactory = await ethers.getContractFactory('StreamRegistryV4')
    // // const streamRegistryFactoryTx = await streamRegistryFactory.deploy(ensCache.address, constants.AddressZero)
    // const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
    //     [Wallet.createRandom().address, forwarder.address], { kind: 'uups' })
    // const streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV4
    // log(`Streamregistry deployed at ${streamRegistry.address}`)
    // log('setting relay hub in paymaster')
    // await (await paymaster.setRelayHub(streamRegistry.signer.getAddress())).wait()
    // log('sending 1 eth to paymaster')
    // const [owner] = await ethers.getSigners();
    // // const balance = (await ethers.getDefaultProvider().getBalance(owner.address)).toString()
    // // const tx = await owner.sendTransaction({ to: paymaster.address,
    // //     value: 10 })
    // // await tx.wait()

    // log('setting target in paymaster')
    // await (await paymaster.setTrustedForwarder(forwarder.address)).wait()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
