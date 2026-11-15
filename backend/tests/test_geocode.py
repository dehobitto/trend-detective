import httpx
import pytest

from app.config import Settings
from app.geocode import USER_AGENT, Geocoder, places_from_nominatim, places_from_photon

PHOTON = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [75.5004841, 30.9293211]},
     "properties": {"osm_key": "place", "osm_value": "state", "type": "state", "name": "Punjab", "country": "India",
                    "extent": [73.8798336, 32.5111793, 76.9390583, 29.5429378]}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0.5618678, 51.1039531]},
     "properties": {"osm_key": "natural", "osm_value": "water", "type": "other", "name": "Lake Chad",
                    "city": "Tunbridge Wells", "county": "Kent", "country": "United Kingdom"}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [178.0, -17.8]},
     "properties": {"type": "country", "name": "Fiji", "extent": [177.0, -12.4, -178.2, -21.0]}},
]}
NOMINATIM = [{"lat": "30.9293211", "lon": "75.5004841", "category": "boundary", "type": "administrative",
              "addresstype": "state", "name": "Punjab", "display_name": "Punjab, India",
              "boundingbox": ["29.5429378", "32.5111793", "73.8798336", "76.9390583"]},
             {"lat": "48.85", "lon": "2.35", "type": "attraction", "name": "",
              "display_name": "Eiffel Tower, Paris, France", "boundingbox": ["48.858", "48.858", "2.294", "2.294"]}]


def test_photon_mapping():
    punjab, lake, fiji = places_from_photon(PHOTON)
    assert punjab.name == "Punjab" and punjab.display_name == "Punjab, India" and punjab.kind == "state"
    assert (punjab.lat, punjab.lon) == (30.9293211, 75.5004841)
    assert punjab.bbox.model_dump() == {"west": 73.8798336, "south": 29.5429378, "east": 76.9390583,
                                        "north": 32.5111793}
    assert lake.bbox is None and lake.kind == "water"  # Photon's "other" type falls back to osm_value
    assert lake.display_name == "Lake Chad, Tunbridge Wells, Kent, United Kingdom"
    assert fiji.bbox is None  # crosses the antimeridian: not expressible as a v1 BBox


def test_nominatim_mapping():
    punjab, tower = places_from_nominatim(NOMINATIM)
    assert punjab.kind == "state" and punjab.bbox.west == 73.8798336 and punjab.bbox.north == 32.5111793
    assert tower.name == "Eiffel Tower" and tower.kind == "attraction"
    assert tower.bbox.east - tower.bbox.west >= 0.05  # a point extent is padded to a valid BBox


class Upstream:
    def __init__(self, photon=None, nominatim=None):
        self.photon, self.nominatim, self.calls = photon, nominatim, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        assert request.headers["User-Agent"] == USER_AGENT
        handler = self.photon if "photon" in request.url.host else self.nominatim
        return handler(request) if handler else httpx.Response(500)


def _client(client, upstream):
    settings = Settings(nominatim_min_interval=0)
    client.app.state.services.geocoder = Geocoder(settings, transport=httpx.MockTransport(upstream))
    return client


def test_geocode_uses_photon_and_caches(client):
    upstream = Upstream(photon=lambda r: httpx.Response(200, json=PHOTON))
    c = _client(client, upstream)
    r = c.get("/api/geocode", params={"q": "Punjab", "limit": 2})
    assert r.status_code == 200, r.text
    places = r.json()
    assert [p["name"] for p in places] == ["Punjab", "Lake Chad"]
    assert set(places[0]) == {"name", "display_name", "lat", "lon", "bbox", "kind", "osm"}
    assert upstream.calls[0].url.params["q"] == "Punjab" and upstream.calls[0].url.params["limit"] == "2"
    assert c.get("/api/geocode", params={"q": "  punjab ", "limit": 2}).json() == places
    assert len(upstream.calls) == 1  # second answer came from the cache


def test_geocode_falls_back_to_nominatim(client):
    upstream = Upstream(photon=lambda r: httpx.Response(503),
                        nominatim=lambda r: httpx.Response(200, json=NOMINATIM))
    places = _client(client, upstream).get("/api/geocode", params={"q": "Punjab"}).json()
    assert places[0]["name"] == "Punjab" and places[0]["kind"] == "state"
    nominatim = upstream.calls[1]
    assert nominatim.url.host == "nominatim.openstreetmap.org" and nominatim.url.params["format"] == "jsonv2"


def test_geocode_timeout_falls_back(client):
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    upstream = Upstream(photon=timeout, nominatim=lambda r: httpx.Response(200, json=NOMINATIM[:1]))
    assert len(_client(client, upstream).get("/api/geocode", params={"q": "Punjab"}).json()) == 1


def test_geocode_upstream_failure_is_502(client):
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    upstream = Upstream(photon=boom, nominatim=lambda r: httpx.Response(429))
    r = _client(client, upstream).get("/api/geocode", params={"q": "Punjab"})
    assert r.status_code == 502
    assert r.json()["detail"].startswith("Place search is unavailable right now")
    assert "Photon: could not connect" in r.json()["detail"] and "Nominatim: HTTP 429" in r.json()["detail"]


@pytest.mark.parametrize("q", ["", "a", "  "])
def test_geocode_needs_two_characters(client, q):
    assert client.get("/api/geocode", params={"q": q}).status_code == 422


def test_nominatim_politeness(monkeypatch):
    sleeps = []
    monkeypatch.setattr("app.geocode.time.sleep", sleeps.append)
    upstream = Upstream(photon=lambda r: httpx.Response(200, json={"features": []}),
                        nominatim=lambda r: httpx.Response(200, json=[]))
    geocoder = Geocoder(Settings(), transport=httpx.MockTransport(upstream))
    assert geocoder.search("nowhere one") == [] and geocoder.search("nowhere two") == []
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 1.0  # the second Nominatim call waited
