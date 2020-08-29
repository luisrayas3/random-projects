#include <FastLED.h>
#include <SparkFun_Qwiic_MP3_Trigger_Arduino_Library.h>


static const int BUTTON_PIN = 8;

static const int NUM_LEDS = 60;
static CRGB leds_[NUM_LEDS];

static MP3TRIGGER mp3_;

struct TrackSpec {
  long cycle_duration_ms;
  long total_duration_ms;
};
static const TrackSpec TRACK_SPECS[] = {
  TrackSpec{.cycle_duration_ms = 3180, .total_duration_ms = 22140},
  TrackSpec{.cycle_duration_ms = 3030, .total_duration_ms = 16290},
  TrackSpec{.cycle_duration_ms = 3050, .total_duration_ms = 16150},
  TrackSpec{.cycle_duration_ms = 3090, .total_duration_ms = 11440},
  TrackSpec{.cycle_duration_ms = 3090, .total_duration_ms = 19990},
};
static const int NUM_TRACKS = sizeof(TRACK_SPECS) / sizeof(TRACK_SPECS[0]);

static const CRGB COLOR_SEQ[] = {
  CRGB::Gold, CRGB::Red, CRGB::Magenta, CRGB::Blue, CRGB::Cyan, CRGB::Lime,
};
static const int NUM_COLORS = sizeof(COLOR_SEQ) / sizeof(COLOR_SEQ[0]);

static const int NUM_GRAD_LEDS = 50, NUM_EXTRA_SOLID_LEDS = 10;
static CRGB GRADIENTS[NUM_COLORS][NUM_GRAD_LEDS];
void initGradients() {
  for (int i = 0; i < NUM_COLORS; ++i) {
    const int j = (i + 1) % NUM_COLORS;
    fill_gradient_RGB(GRADIENTS[i], NUM_GRAD_LEDS, COLOR_SEQ[i], COLOR_SEQ[j]);
  }
}
static const int GRAD_START_LED = NUM_LEDS + NUM_EXTRA_SOLID_LEDS;
static const int TOTAL_SUBCYCLE_LEDS = GRAD_START_LED + NUM_GRAD_LEDS;

static const int NUM_STYLES = NUM_TRACKS;  // For `cycleStyle` function


void reset() {
  digitalWrite(LED_BUILTIN, LOW);  // Debug LED
  FastLED.clear(true);
  mp3_.stop();
}

void startTrack(int track_index) {
  mp3_.playFile(track_index + 1);
}

void colorLeds(long time_in_track, long cycle_duration) {
  cycle_duration /= 2;  // Cycle colors twice per track cycle
  const float point_in_cycle =
      static_cast<float>(time_in_track % cycle_duration) / cycle_duration;
  const int color1_index = static_cast<int>(NUM_COLORS * point_in_cycle);
  const int color2_index = (color1_index + 1) % NUM_COLORS;
  const float point_in_color = point_in_cycle * NUM_COLORS - color1_index;
  const int first_grad_led =
      GRAD_START_LED - static_cast<int>(point_in_color * TOTAL_SUBCYCLE_LEDS);
  const int first_color2_led = first_grad_led + NUM_GRAD_LEDS;

  // Color each of 3 sections: color1, gradient, color2
  for (int led_index = 0; led_index < NUM_LEDS; ++led_index) {
    if (led_index < first_grad_led) {
      leds_[led_index] = COLOR_SEQ[color1_index];
    } else if (led_index < first_color2_led) {
      leds_[led_index] = GRADIENTS[color1_index][led_index - first_grad_led];
    } else {
      leds_[led_index] = COLOR_SEQ[color2_index];
    }
  }
  FastLED.show();
}


void setup() {
  // Debugging
  pinMode(LED_BUILTIN, OUTPUT);

  // Button config
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // LED config
  static const int LED_DATA_PIN = 11;
  static const int LED_CLOCK_PIN = 13;
  FastLED.addLeds<APA102, LED_DATA_PIN, LED_CLOCK_PIN, BGR>(leds_, NUM_LEDS);
  FastLED.clear(true);
  FastLED.setBrightness(95);  // 0-255
  initGradients();

  // MP3 config
  Wire.begin();
  mp3_.begin();  // TODO: returns false on failure
  mp3_.setVolume(31);  // 0-31

  // Sets outputs as they are in IDLE
  reset();
}

// Simple button read
struct ButtonState { bool edge; bool pressed; };
struct ButtonState getButton(long now) {
  static const long DEBOUNCE_MS = 20;
  static bool latched_pressed = false;
  static long change_start_ms = now;

  const bool pressed = !digitalRead(BUTTON_PIN);

  if (pressed == latched_pressed) {
    change_start_ms = now;
  }
  if (now - change_start_ms < DEBOUNCE_MS) {
    return {.edge = false, .pressed = latched_pressed};
  }

  latched_pressed = pressed;
  change_start_ms = now;
  return {.edge = true, .pressed = latched_pressed};
}

// Returns the next "style" or -1 if all styles have been cycled through.
// If reset this returns the last style returned or the starting style of the
// last cycle if all styles were cycled through.
int cycleStyle(bool reset = false) {
  static int style_on_reset = 0;
  static int style = -1;

  if (reset) {
    if (style < 0) {
      style = style_on_reset;
    } else {
      style_on_reset = style;
    }
    return style;
  }
  if (style < 0) return style;

  style += 1;
  style %= NUM_STYLES;
  if (style == style_on_reset) {
    style = -1;
  }
  return style;
}

// Main state-machine
enum State {
  // On edge up -> SELECTING
  // On edge down -> IDLE
  STATE_IDLE = 0,

  // On edge up -> N/A
  // On edge down -> PLAYING
  STATE_SELECTING = 1,

  // On edge up -> IDLE
  // On edge down -> N/A
  STATE_PLAYING = 2,
};
void loop() {
  long now = millis();

  // Run the main state machine
  static State state = STATE_IDLE;
  static long track_start_ms = 0;
  static int track_index = 0;

  // Helpers, must be recalculated after transition checking
  long time_in_track = now - track_start_ms;
  const TrackSpec* track = &TRACK_SPECS[track_index];

  // Handle transitions
  const struct ButtonState button = getButton(now);
  const bool new_pressed = button.edge && button.pressed;
  const bool new_released = button.edge && !button.pressed;
  switch (state) {
    case STATE_IDLE:
      if (new_pressed) {
        state = STATE_SELECTING;
        track_index = cycleStyle(true);
        startTrack(track_index);
        track_start_ms = now;
      }
      break;
    case STATE_SELECTING:
      if (new_released) {
        state = STATE_PLAYING;
      } else if (time_in_track > track->cycle_duration_ms) {
        track_index = cycleStyle(false);
        if (track_index < 0) {
          state = STATE_IDLE;
          reset();
        } else {
          startTrack(track_index);
          track_start_ms = now;
        }
      }
      break;
    case STATE_PLAYING:
      if (new_pressed || time_in_track > track->total_duration_ms) {
        state = STATE_IDLE;
        reset();
      }
      break;
  }

  time_in_track = now - track_start_ms;
  track = &TRACK_SPECS[track_index];

  // Set the outputs per the current state
  switch (state) {
    case STATE_IDLE: {
      digitalWrite(LED_BUILTIN, LOW);
      break;
    }
    case STATE_SELECTING: {
      // Does 2 quick blinks in first 1/2 second then steadies to 2 blinks/s
      const long blink_ms = time_in_track < 500 ? 125 : 250;
      digitalWrite(LED_BUILTIN, time_in_track / blink_ms % 2 ? LOW : HIGH);
      colorLeds(time_in_track, track->cycle_duration_ms);
      break;
    }
    case STATE_PLAYING: {
      digitalWrite(LED_BUILTIN, HIGH);
      colorLeds(time_in_track, track->cycle_duration_ms);
      break;
    }
  }
}
