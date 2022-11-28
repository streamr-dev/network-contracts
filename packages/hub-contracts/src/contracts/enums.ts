// TODO: where should enums be so they'd stay synced automagically?
export const ProductState = {
    NotDeployed: 0, // non-existent or deleted
    Deployed: 1, // created or redeployed
}
export const productStateName = Object.getOwnPropertyNames(ProductState)
