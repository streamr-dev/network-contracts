import { RelayProvider } from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/dev'
import { ethers, upgrades, waffle } from 'hardhat'
import { it, describe, before } from 'mocha'
import { assert } from 'chai'
import type { StreamRegistryV4 } from '../typechain/StreamRegistryV4'


import Web3HttpProvider from 'web3-providers-http'

//we still use truffle compiled files
import registryArtifact from "../artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json"
import { BigNumber } from 'ethers'

describe.only('using ethers with OpenGSN', () => {
    let registry : StreamRegistryV4
    let registryGsn : StreamRegistryV4
    let accounts
    let web3provider
    let from: string
    let trustedForwarderAddress: string
    before(async () => {
        const env = await GsnTestEnvironment.startGsn('localhost')

        const { paymasterAddress, forwarderAddress } = env.contractsDeployment
        trustedForwarderAddress = forwarderAddress ?? ''
    
        const web3provider = new Web3HttpProvider('http://localhost:8545')
 
        const deploymentProvider= new ethers.providers.Web3Provider(web3provider)

        const factory = new ethers.ContractFactory(registryArtifact.abi, registryArtifact.bytecode, deploymentProvider.getSigner())

        // registry = await factory.deploy(forwarderAddress) as StreamRegistryV4
        // await registry.deployed()
        // const streamRegistryFactoryV4 = await ethers.getContractFactory('StreamRegistryV4')
        const streamRegistryFactoryV4Tx = await upgrades.deployProxy(factory,
            ['0x0000000000000000000000000000000000000000', forwarderAddress], {
                kind: 'uups'
            })
            registry = await streamRegistryFactoryV4Tx.deployed() as StreamRegistryV4

        const config = await {
            // loggerConfiguration: { logLevel: 'error'},
            paymasterAddress: paymasterAddress,
            auditorsCount: 0
        }
        // const hdweb3provider = new HDWallet('0x123456', 'http://localhost:8545')
        const gsnProvider = RelayProvider.newProvider({provider: web3provider, config})
    	await gsnProvider.init()
	   // The above is the full provider configuration. can use the provider returned by startGsn:
        // const gsnProvider = env.relayProvider

    	const account = new ethers.Wallet(Buffer.from('1'.repeat(64),'hex'))
        gsnProvider.addAccount(account.privateKey)
    	from = account.address

        // gsnProvider is now an rpc provider with GSN support. make it an ethers provider:
        const etherProvider = new ethers.providers.Web3Provider(gsnProvider)

        registryGsn = registry.connect(etherProvider.getSigner(from))
    })

    describe('make a call', async () => {
        let sid = "/sid"
        let metadata = "metadata"
        let metadataRead: String
        let balanceUsed
        before(async () => {
            console.log("trustedForwarderAddress", trustedForwarderAddress)
            console.log("is trusted forwarder address: ", await registry.isTrustedForwarder(trustedForwarderAddress))
            // console.log("is trusted forwarder address gsn: ", await registryGsn.isTrustedForwarder(trustedForwarderAddress))
            
            await registry.createStream(sid, metadata, {gasLimit: 1e6})
            // await registryGsn.createStream(sid, metadata, {gasLimit: 1e6})
            metadataRead = await registry.getStreamMetadata((await waffle.provider.getWallets())[0].address.toLowerCase() + sid)
        })

        it('should have created stream', async () => {
            assert.equal(metadata, metadataRead)
        })

        // it('should not pay for gas (balance=0)', async () => {
        //     assert.equal(BigNumber.from(0), await registry.provider.getBalance(from))
        // })

        // it('should see the real caller', async () => {
        //     assert.equal(from.toLowerCase(), (await registry.lastCaller()).toLowerCase())
        // });

    })
})

