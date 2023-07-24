import { log } from '@graphprotocol/graph-ts'
import { NewOperator } from '../generated/OperatorFactory/OperatorFactory'
import { Operator as OperatorTemplate } from '../generated/templates'
import { loadOrCreateOperator } from './helpers'

export function handleNewOperator(event: NewOperator): void {
    let contractAddress = event.params.operatorContractAddress
    let contractAddressString = contractAddress.toHexString()
    log.info('handleNewOperator: operatorAddress={} blockNumber={}', [contractAddressString, event.block.number.toString()])

    // Instantiate template
    OperatorTemplate.create(contractAddress)

    let operator = loadOrCreateOperator(contractAddressString)
    operator.save()
    // log.info('handleNewOperator: operatorId={}', [operator.id])
}
