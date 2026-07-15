package server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

var genAttr = regexp.MustCompile(`data-gen="(\d+)"`)

func fireDemo(t *testing.T, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/demo"+query, nil)
	rec := httptest.NewRecorder()
	testMux().ServeHTTP(rec, req)
	return rec
}

func TestDemoFragmentDefaultsToInnerHTML(t *testing.T) {
	rec := fireDemo(t, "")

	body := rec.Body.String()
	if want := "innerHTML"; !strings.Contains(body, want) {
		t.Fatalf("body = %q, want it to mention %q", body, want)
	}
	if strings.Contains(body, "<button") {
		t.Fatalf("body = %q, innerHTML fragment must not include a wrapping element", body)
	}
}

func TestDemoFragmentOuterHTMLIncludesWrappingElement(t *testing.T) {
	rec := fireDemo(t, "?swap=outerHTML")

	body := rec.Body.String()
	for _, want := range []string{`id="demo-el"`, `hx-swap="outerHTML"`, `hx-target="#demo-el"`, `hx-get="api/demo?swap=outerHTML&amp;target=self"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %q, want it to contain %q", body, want)
		}
	}
}

func TestDemoFragmentRejectsUnsupportedSwapValue(t *testing.T) {
	rec := fireDemo(t, "?swap=bogus")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDemoFragmentRejectsUnsupportedTargetValue(t *testing.T) {
	rec := fireDemo(t, "?target=bogus")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDemoFragmentDefaultsToSelfTarget(t *testing.T) {
	rec := fireDemo(t, "?swap=outerHTML")

	body := rec.Body.String()
	if want := `id="demo-el"`; !strings.Contains(body, want) {
		t.Fatalf("body = %q, want it to default to the self target (%q)", body, want)
	}
}

func TestDemoFragmentExternalTargetInnerHTMLOmitsWrapper(t *testing.T) {
	rec := fireDemo(t, "?swap=innerHTML&target=external")

	body := rec.Body.String()
	if strings.Contains(body, "demo-target-external") {
		t.Fatalf("body = %q, innerHTML fragment must not include the external wrapper", body)
	}
}

func TestDemoFragmentExternalTargetOuterHTMLIncludesWrapper(t *testing.T) {
	rec := fireDemo(t, "?swap=outerHTML&target=external")

	body := rec.Body.String()
	for _, want := range []string{`id="demo-target-external"`, "external"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %q, want it to contain %q", body, want)
		}
	}
	if strings.Contains(body, `id="demo-el"`) {
		t.Fatalf("body = %q, external target swap must not re-declare the trigger button", body)
	}
}

func TestDemoFragmentGenerationIncrementsAcrossRequests(t *testing.T) {
	first := genOf(t, fireDemo(t, "").Body.String())
	second := genOf(t, fireDemo(t, "").Body.String())

	if second <= first {
		t.Fatalf("gen did not increase: first=%d second=%d", first, second)
	}
}

func TestDemoFragmentInnerAndOuterShareSameGenScheme(t *testing.T) {
	inner := genOf(t, fireDemo(t, "?swap=innerHTML").Body.String())
	outer := genOf(t, fireDemo(t, "?swap=outerHTML").Body.String())

	if outer <= inner {
		t.Fatalf("expected outerHTML gen to be greater than preceding innerHTML gen: inner=%d outer=%d", inner, outer)
	}
}

func TestDemoFragmentSelectWrapsPayloadWithNoiseAndMarker(t *testing.T) {
	rec := fireDemo(t, "?select=1")

	body := rec.Body.String()
	for _, want := range []string{"fragment-noise", "data-fragment-content"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %q, want it to contain %q", body, want)
		}
	}
}

func TestDemoFragmentWithoutSelectOmitsNoiseAndMarker(t *testing.T) {
	rec := fireDemo(t, "")

	body := rec.Body.String()
	for _, unwanted := range []string{"fragment-noise", "data-fragment-content"} {
		if strings.Contains(body, unwanted) {
			t.Fatalf("body = %q, want it to omit %q when select is not requested", body, unwanted)
		}
	}
}

func TestDemoFragmentSelectMarksTheExternalOuterHTMLWrapper(t *testing.T) {
	rec := fireDemo(t, "?swap=outerHTML&target=external&select=1")

	body := rec.Body.String()
	for _, want := range []string{"fragment-noise", `id="demo-target-external"`, `data-fragment-content`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %q, want it to contain %q", body, want)
		}
	}
	// The marker must sit on the external div itself (the node hx-select
	// picks and outerHTML swaps in), not merely somewhere in the noise.
	if !strings.Contains(body, `class="demo-target-external" data-fragment-content data-gen`) {
		t.Fatalf("body = %q, want data-fragment-content on the external wrapper element", body)
	}
}

func TestDemoFragmentIndicatorDelaysTheResponse(t *testing.T) {
	original := demoIndicatorDelay
	demoIndicatorDelay = 30 * time.Millisecond
	t.Cleanup(func() { demoIndicatorDelay = original })

	start := time.Now()
	fireDemo(t, "?indicator=1")
	if elapsed := time.Since(start); elapsed < demoIndicatorDelay {
		t.Fatalf("elapsed = %v, want at least %v", elapsed, demoIndicatorDelay)
	}
}

func TestDemoFragmentWithoutIndicatorDoesNotDelay(t *testing.T) {
	original := demoIndicatorDelay
	demoIndicatorDelay = 200 * time.Millisecond
	t.Cleanup(func() { demoIndicatorDelay = original })

	start := time.Now()
	fireDemo(t, "")
	if elapsed := time.Since(start); elapsed >= demoIndicatorDelay {
		t.Fatalf("elapsed = %v, want a response well under the indicator delay of %v", elapsed, demoIndicatorDelay)
	}
}

func genOf(t *testing.T, body string) int {
	t.Helper()
	m := genAttr.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("body = %q, want a data-gen attribute", body)
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatalf("data-gen value %q is not an integer: %v", m[1], err)
	}
	return n
}
