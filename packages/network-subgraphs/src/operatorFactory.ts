import { log } from '@graphprotocol/graph-ts'
import { NewOperator, VoterUpdate } from '../generated/OperatorFactory/OperatorFactory'
import { Operator as OperatorTemplate } from '../generated/templates'
import { loadOrCreateNetwork, loadOrCreateOperator } from './helpers'

export function handleNewOperator(event: NewOperator): void {
    let contractAddress = event.params.operatorContractAddress
    let contractAddressString = contractAddress.toHexString()
    log.info('handleNewOperator: operatorAddress={} blockNumber={}', [contractAddressString, event.block.number.toString()])

    // Instantiate template
    OperatorTemplate.create(contractAddress)

    let operator = loadOrCreateOperator(contractAddressString)
    operator.save()
    log.info('handleNewOperator: operatorId={}', [operator.id])

    let network = loadOrCreateNetwork()
    network.operatorsCount = network.operatorsCount + 1
    network.save()
}

export function handleVoterUpdate(event: VoterUpdate): void {
    let voterRegistryAddress = event.address.toHexString()
    let voter = event.params.voterAddress.toHexString()
    let isVoter = event.params.isVoter
    log.info('handleVoterUpdate: voterRegistryAddress={} voter={} isVoter={} blockNumber={}', 
        [voterRegistryAddress, voter, isVoter.toString(), event.block.number.toString()])

    let network = loadOrCreateNetwork()
    network.eligibleVotersCount = isVoter 
        ? network.eligibleVotersCount + 1
        : network.eligibleVotersCount - 1
    network.save()
}
