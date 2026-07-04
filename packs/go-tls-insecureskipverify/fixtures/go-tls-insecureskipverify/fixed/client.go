package client

import "crypto/tls"

// newClient builds the API client's TLS transport.
func newClient() *tls.Config {
	// FIXED: certificate verification enforced (the secure default, explicit here).
	return &tls.Config{InsecureSkipVerify: false}
}
