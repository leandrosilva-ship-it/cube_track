import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SignedXml } from 'xml-crypto';

/** Certificado/chave de teste (autoassinado via `openssl`, só para os testes de ADR 0057 — nunca
 * usado em produção). Gerado uma vez por processo de teste. */
export function generateTestIdpCertificate(): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cube-saml-'));
  const keyPath = join(dir, 'idp.key');
  const certPath = join(dir, 'idp.crt');
  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=cube-track-test-idp',
      '-sha256',
    ]);
    return { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface SignedSamlResponseInput {
  idpEntityId: string;
  spEntityId: string;
  acsUrl: string;
  nameId: string;
  attributes: Record<string, string>;
  privateKey: string;
  publicCert: string;
  /** Corrompe a assertion DEPOIS de assinada (para o teste de rejeição). */
  tamperAfterSigning?: boolean;
}

/** Monta e assina (xml-dsig, C14N exclusiva, RSA-SHA256) uma asserção SAML 2.0 — usada pelos testes
 * de verificação de assinatura, contra o mesmo `@node-saml/node-saml` que a API usa em produção. */
export function buildSignedSamlResponse(input: SignedSamlResponseInput): string {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60_000).toISOString();
  const responseId = `_response_${Math.random().toString(36).slice(2)}`;
  const assertionId = `_assertion_${Math.random().toString(36).slice(2)}`;

  const attributeStatements = Object.entries(input.attributes)
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${name}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`,
    )
    .join('');

  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">` +
    `<saml:Issuer>${input.idpEntityId}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${input.nameId}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${input.acsUrl}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${input.spEntityId}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_session_1">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>${attributeStatements}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const sig = new SignedXml({
    privateKey: input.privateKey,
    publicCert: input.publicCert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(assertion, {
    location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
  });
  let signedAssertion = sig.getSignedXml();
  if (input.tamperAfterSigning === true) {
    signedAssertion = signedAssertion.replace(input.nameId, `attacker-${input.nameId}`);
  }

  const response =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" ` +
    `IssueInstant="${now.toISOString()}" Destination="${input.acsUrl}">` +
    `<saml:Issuer>${input.idpEntityId}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signedAssertion +
    `</samlp:Response>`;

  return Buffer.from(response, 'utf8').toString('base64');
}
