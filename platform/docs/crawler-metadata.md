# Public crawler metadata

Next metadata routes serve `/sitemap.xml` and `/robots.txt` using the canonical
`SITE_ORIGIN` (`https://youtube.observe.tw`), including in local previews. The
initial sitemap is bounded to 20 implemented public entry points. It does not
query databases, enumerate private reader state or manufacture modification
timestamps. Dynamic channel/video/event detail discovery can be added from a
verified published-source inventory later; the sitemap does not claim to list
every detail page.

Robots allows public pages and excludes auth/login, reader, management, operator,
API/runtime, personal feed, local board and legacy mutation prefixes. These are
crawler instructions, not access controls. Existing authorization stays required.

The header search form submits `q` to `/videos`; `/search` is not an application
route. Tests verify the actual rendered form destination alongside canonical
sitemap URLs, public route resolution, boundedness and private-path exclusions.
