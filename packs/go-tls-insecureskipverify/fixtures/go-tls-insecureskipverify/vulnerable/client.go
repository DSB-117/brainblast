package client

import "crypto/tls"

// newClient builds the API client's TLS transport.
func newClient() *tls.Config {
	// VULNERABLE: certificate verification OFF — any MITM cert is accepted.
	return &tls.Config{InsecureSkipVerify: true}
}
