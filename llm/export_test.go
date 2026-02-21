package llm

import "time"

// SetRetryDelays overrides retryDelays for the duration of a test and returns
// a restore function to be called via t.Cleanup.
func SetRetryDelays(d []time.Duration) func() {
	orig := retryDelays
	retryDelays = d
	return func() { retryDelays = orig }
}
