// scripts/deploy.js
import { Contract } from 'ethers'
import hhat from 'hardhat'

import { StreamRegistry } from '../typechain/StreamRegistry'

const { ethers } = hhat

async function main() {
    const forwaderFactory = await ethers.getContractFactory('Forwarder')
    console.log('Deploying Forwarder...')
    const forwarder = await forwaderFactory.deploy() as Contract
    console.log('Forwarder deployed to:', forwarder.address)

    // const relayhubFactory = await ethers.getContractFactory('RelayHub')
    // console.log('Deploying Relayhub...')
    // const relayHub = await relayhubFactory.deploy() as Contract
    // console.log('Relayhub deployed to:', relayHub.address)

    const paymasterFactory = await ethers.getContractFactory('NaivePaymaster')
    console.log('Deploying Paymaster...')
    const paymaster = await paymasterFactory.deploy() as Contract
    console.log('Paymaster deployed to:', paymaster.address)

    const streamRegistryFactory = await ethers.getContractFactory('StreamRegistry')
    console.log('Deploying StreamRegistry...')
    const streamRegistry = await streamRegistryFactory.deploy(
        streamRegistryFactory.signer.getAddress(), streamRegistryFactory.signer.getAddress(),
        streamRegistryFactory.signer.getAddress()
    ) as StreamRegistry
    console.log('StreamRegistry deployed to:', streamRegistry.address)

    await paymaster.setRelayHub(streamRegistry.signer.getAddress())
    streamRegistryFactory.signer.sendTransaction({
        to: paymaster.address,
        value: ethers.utils.parseEther('1')
    })

    const tx = await paymaster.setTarget(forwarder.address)
    tx.wait()
    // deploy proxyAdmin contract
    // const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin')
    // console.log('Deploying ProxyAdmin...')
    // const proxyAdmin = await ProxyAdmin.deploy()
    // console.log('ProxyAdmin deployed to:', proxyAdmin.address)

    // // deploy proxy contract
    // const TransparentUpgradeableProxy = await ethers.getContractFactory('TransparentUpgradeableProxy')
    // console.log('Deploying StreamRegistry Proxy...')
    // const transparentUpgradeableProxy = await TransparentUpgradeableProxy
    //     .deploy(streamRegistry.address, proxyAdmin.address, [])
    // console.log('StreamRegistry Proxy deployed to:', transparentUpgradeableProxy.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
