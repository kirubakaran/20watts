# Extra CA certificates for the asset pipeline

`sectigo-ov-r36.pem` is the public Sectigo intermediate ("Sectigo Public
Server Authentication CA OV R36") that cdn.3d-api.si.edu, the Smithsonian
3D CDN, omits from its TLS handshake. Browsers and curl fetch missing
intermediates themselves; Node does not, so `npm run fetch-assets` passes
this file through `NODE_EXTRA_CA_CERTS`. It was downloaded from the
certificate's own Authority Information Access URL,
http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt.
Delete it once the CDN sends a full chain.
