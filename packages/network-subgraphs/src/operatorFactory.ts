import { log } from '@graphprotocol/graph-ts'

import { NewOperator } from '../generated/OperatorFactory/OperatorFactory'
import { Operator as OperatorTemplate } from '../generated/templates'
import { loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'

export function handleNewOperator(event: NewOperator): void {
    let contractAddress = event.params.operatorContractAddress
    let contractAddressString = contractAddress.toHexString()
    log.info('handleNewOperator: operatoraddress={} blockNumber={}', [contractAddressString, event.block.number.toString()])
    
    let operator = loadOrCreateOperator(contractAddressString)
    operator.save()

    loadOrCreateOperatorDailyBucket(contractAddressString, event.block.timestamp)

    // Instantiate template
    OperatorTemplate.create(contractAddress)
}
