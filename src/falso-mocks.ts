import {
  randFirstName,
  randLastName,
  randFullName,
  randEmail,
  randUrl,
  randUuid,
  randPhoneNumber,
  randStreetAddress,
  randCity,
  randCountry,
  randZipCode,
  randCompanyName,
  randJobTitle,
  randProductName,
  randSentence,
  randParagraph,
  randPastDate,
  randFutureDate,
  randNumber,
  randBoolean,
  randWord,
} from '@ngneat/falso'
import type { IMocks } from '@graphql-tools/mock'

export type FakeType =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'url'
  | 'uuid'
  | 'phoneNumber'
  | 'streetAddress'
  | 'city'
  | 'country'
  | 'zipCode'
  | 'companyName'
  | 'jobTitle'
  | 'productName'
  | 'sentence'
  | 'paragraph'
  | 'pastDate'
  | 'futureDate'
  | 'price'
  | 'word'
  | 'boolean'
  | 'number'

export const fakeTypeGenerators: Record<FakeType, () => unknown> = {
  firstName: () => randFirstName(),
  lastName: () => randLastName(),
  fullName: () => randFullName(),
  email: () => randEmail(),
  url: () => randUrl(),
  uuid: () => randUuid(),
  phoneNumber: () => randPhoneNumber(),
  streetAddress: () => randStreetAddress(),
  city: () => randCity(),
  country: () => randCountry(),
  zipCode: () => randZipCode(),
  companyName: () => randCompanyName(),
  jobTitle: () => randJobTitle(),
  productName: () => randProductName(),
  sentence: () => randSentence(),
  paragraph: () => randParagraph(),
  pastDate: () => randPastDate().toISOString(),
  futureDate: () => randFutureDate().toISOString(),
  price: () => randNumber({ min: 1, max: 999, fraction: 2 }),
  word: () => randWord(),
  boolean: () => randBoolean(),
  number: () => randNumber({ min: 1, max: 1000 }),
}

const BUILT_IN_FAKE_TYPES = [
  'firstName', 'lastName', 'fullName', 'email', 'url', 'uuid', 'phoneNumber',
  'streetAddress', 'city', 'country', 'zipCode', 'companyName', 'jobTitle',
  'productName', 'sentence', 'paragraph', 'pastDate', 'futureDate', 'price',
  'word', 'boolean', 'number',
]

// Injected into the merged schema so @fake, @listSize, and @error are available in extensions SDL.
// customScalarNames extends the FakeType enum with user-provided generator names.
export function buildFakeDirectiveSDL(customScalarNames: string[] = []): string {
  const allTypes = [...BUILT_IN_FAKE_TYPES, ...customScalarNames]
  return `
  enum FakeType {
    ${allTypes.join('\n    ')}
  }

  directive @fake(type: FakeType, oneOf: [String!]) on FIELD_DEFINITION
  directive @listSize(min: Int, max: Int, count: Int) on FIELD_DEFINITION
  directive @error(message: String, code: String, classification: String, serviceName: String, statusCode: Int) on FIELD_DEFINITION
`
}

// Default scalar mocks — applied to all fields without an explicit @fake directive
export const scalarMocks: IMocks = {
  ID: () => randUuid(),
  String: () => randWord(),
  Int: () => randNumber({ min: 1, max: 1000 }),
  Float: () => randNumber({ min: 0, max: 1000, fraction: 2 }),
  Boolean: () => randBoolean(),
}
