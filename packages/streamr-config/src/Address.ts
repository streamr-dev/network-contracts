export class Address {
  constructor(private readonly value: string) {
    if (value.length !== 42) {
      throw new Error(`Address length must be 42, got ${value.length}: ${value}`)
    }
  }

  toString(): string {
    return this.value
  }
}
