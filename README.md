# Google Cast Card

A beautiful, smart Lovelace card for Home Assistant to control **Google Cast** and **Nest Audio** speakers.

## Features

- 🎨 Album art banner with smooth zoom animation
- 🎵 Auto-scrolling song title, artist & album
- ⏯ Play / Pause / Previous / Next controls
- ⏩ Seek ±N seconds (configurable)
- 🔊 Volume slider + Mute toggle
- 🟢 Live status dot with per-speaker pills
- ⏱ Live progress bar (synced with HA)
- 🤖 **Smart auto-select** — automatically controls whichever speaker(s) are active in the room
- 📦 Supports single entity, list of entities, or HA groups

---

## Installation

### HACS (recommended)

1. HACS → Frontend → Custom repositories
2. Add `https://github.com/your-username/google-cast-card` as **Lovelace**
3. Install **Google Cast Card**
4. Add resource in HA → Settings → Dashboards → Resources:
   ```
   /hacsfiles/google-cast-card/google-cast-card.js
   ```

### Manual

1. Copy `google-cast-card.js` to `/config/www/google-cast-card/google-cast-card.js`
2. Add resource:
   ```
   /local/google-cast-card/google-cast-card.js
   ```

---

## Configuration

### Simplest — single speaker

```yaml
type: custom:google-cast-card
entity: media_player.living_room_speaker
```

### Multiple speakers in a room (recommended)

```yaml
type: custom:google-cast-card
name: Living Room
entities:
  - media_player.living_room_left
  - media_player.living_room_right
  - media_player.living_room_sub
```

The card automatically detects which speaker(s) are playing and controls those.

### With a HA group (for synchronized multi-speaker control)

```yaml
type: custom:google-cast-card
name: Living Room
entities:
  - media_player.living_room_left
  - media_player.living_room_right
  - media_player.living_room_sub
group: media_player.living_room_group
```

When 2+ speakers are active simultaneously, commands are sent to the group entity so all active speakers are controlled together.

---

## Smart auto-select logic

| Situation | What happens |
|---|---|
| 1 speaker playing | Controls that speaker directly |
| 2+ speakers playing | Controls the group (if `group:` is set), otherwise the first active |
| All paused | Controls whichever is paused (same priority) |
| None active | Shows idle state |
| Active speaker changes | Card auto-switches and shows a brief notice |

---

## All options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | — | Single `media_player.xxx` entity |
| `entities` | list | — | List of `media_player.xxx` entities in the room |
| `group` | string | — | HA group entity used when 2+ speakers are active |
| `name` | string | friendly_name | Label shown on the card badge |
| `seek_seconds` | number | `10` | Seconds for seek ±N buttons |
| `show_seek` | boolean | `true` | Show seek buttons |

At least one of `entity`, `entities`, or `group` must be defined.

---

## License

MIT
