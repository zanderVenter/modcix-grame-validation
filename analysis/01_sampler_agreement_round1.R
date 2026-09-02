#!/usr/bin/env Rscript
# Round 1 sampler-agreement analysis.
#
# Pipeline stage 6: quantify sampler agreement on the GEE sampling app's
# output and identify REFIDs that need re-verification, before the reference
# sample is consolidated (stage 7).
#
# Input: the raw CSV export of the app's Google Sheet
# (config PROJDIR/data/from_samplers/public_greenet_collection - Sheet1.csv).
# One row = one sampler's submission for one REFID. Each REFID was, by
# design, shown to two samplers; some ended up with 1, 3, or more rows
# (repeat/incomplete sessions) - handled explicitly below.
#
# Timing-agreement tolerance (12 days) and the nearest-match approach mirror
# the accuracy-assessment method in the original MODCiX paper (Schweider et
# al. 2026) and its reference implementation
# (https://github.com/geo-masc/modcix/blob/main/src/evaluation.Rmd), so that
# interpreter agreement here is computed the same way GRAME itself will
# later be scored against this reference sample.
#
# Run from the repo root: Rscript analysis/01_sampler_agreement_round1.R

library(tidyverse)

source("src/config.R")

TOLERANCE_DAYS <- 12 # matches TOLERANCE in geo-masc/modcix's evaluation.Rmd
LOW_CONFIDENCE_LEVELS <- c("low", "very low")

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

catalog <- load_catalog()
csv_path <- file.path(
  catalog$project_data$filepath, "data", "from_samplers",
  "public_greenet_collection - Sheet1.csv"
)

# Outputs go to PROJDIR/output, not into the repo - they contain contributor
# names and are project data, not code (see README.md's "Data" section).
out_dir <- file.path(catalog$project_data$filepath, "output", "sampler_agreement_round1")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

raw <- read_csv(csv_path, col_types = cols(.default = "c"), na = character())

mow_cols <- paste0("mow_", 1:7)
conf_cols <- paste0("mow_", 1:7, "_conf")

samples <- raw %>%
  mutate(
    sampler = str_trim(selectedName),
    # lowercased/trimmed key for grouping only - the raw data has casing
    # inconsistencies (e.g. "IGN2" vs "ign2") for what look like the same
    # contributor.
    sampler_key = str_to_lower(sampler),
    session_id = as.numeric(sessionID),
    is_grassland = na_if(str_trim(is_grassland), ""),
    is_processed = str_trim(is_processed),
    processed = is_processed == "Yes",
    skipped = is_processed == "No - skipping to next",
    across(all_of(mow_cols), ~ suppressWarnings(as.Date(na_if(.x, "")))),
    # the confidence dropdown's unselected placeholder text - treat as missing
    across(all_of(conf_cols), ~ na_if(na_if(str_trim(.x), ""), "-confidence-")),
    overall_confidence = suppressWarnings(as.numeric(confidence))
  ) %>%
  rowwise() %>%
  mutate(n_events = sum(!is.na(c_across(all_of(mow_cols))))) %>%
  ungroup()

# Keep one row per REFID x sampler: if the same person submitted a REFID more
# than once (216 cases in round 1), keep their most recent session only -
# these are not independent second opinions.
samples_dedup <- samples %>%
  group_by(REFID, sampler_key) %>%
  slice_max(order_by = session_id, n = 1, with_ties = FALSE) %>%
  ungroup()

# Event-level long table (one row per labelled mowing event), used for the
# low-confidence flag and the timing-agreement matching.
dates_long <- samples_dedup %>%
  select(REFID, sampler, sampler_key, session_id, all_of(mow_cols)) %>%
  pivot_longer(all_of(mow_cols), names_to = "mow_col", values_to = "date") %>%
  mutate(event_num = as.integer(str_remove(mow_col, "mow_"))) %>%
  select(-mow_col)

conf_long <- samples_dedup %>%
  select(REFID, sampler, sampler_key, session_id, all_of(conf_cols)) %>%
  pivot_longer(all_of(conf_cols), names_to = "conf_col", values_to = "confidence") %>%
  mutate(event_num = as.integer(str_remove(str_remove(conf_col, "_conf"), "mow_"))) %>%
  select(-conf_col)

event_long <- dates_long %>%
  left_join(conf_long, by = c("REFID", "sampler", "sampler_key", "session_id", "event_num")) %>%
  filter(!is.na(date))

cat("\n==================== 1. SUMMARY STATISTICS ====================\n\n")

n_rows <- nrow(samples)
n_refids <- n_distinct(samples$REFID)
n_refids_dedup <- n_distinct(samples_dedup$REFID)
n_samplers <- n_distinct(samples$sampler_key)

cat("Total submissions (rows):", n_rows, "\n")
cat("Unique REFIDs touched:", n_refids, "\n")
cat("Unique samplers:", n_samplers, "\n\n")

refid_label_counts <- samples %>% count(REFID, name = "n_labels")
cat("REFIDs by number of submissions received:\n")
print(count(refid_label_counts, n_labels, name = "n_refids"))

skipped_n <- sum(samples$skipped)
cat("\nSkipped submissions (\"No - skipping to next\"):", skipped_n,
    sprintf("(%.1f%% of all rows)\n", 100 * skipped_n / n_rows))

grassland_tab <- samples %>% count(is_grassland)
cat("\nis_grassland distribution (all submissions):\n")
print(grassland_tab)
pct_grassland <- 100 * sum(samples$is_grassland == "Yes", na.rm = TRUE) / n_rows
cat(sprintf("Grassland = Yes: %.1f%% of all submissions\n", pct_grassland))

processed_grassland <- samples %>% filter(processed, is_grassland == "Yes")
total_events <- sum(processed_grassland$n_events)
cat("\nProcessed + confirmed-grassland submissions:", nrow(processed_grassland), "\n")
cat("Total mowing events labelled across those submissions:", total_events, "\n")
cat(sprintf(
  "Mean events per confirmed-grassland submission: %.2f\n",
  mean(processed_grassland$n_events)
))

events_hist <- processed_grassland %>% count(n_events)
cat("\nHistogram of mowing-event counts (processed, grassland = Yes):\n")
print(events_hist)

hist_plot <- ggplot(processed_grassland, aes(x = n_events)) +
  geom_bar(fill = "#2c7fb8") +
  scale_x_continuous(breaks = 0:7) +
  labs(
    title = "Mowing events per sample (round 1)",
    x = "Number of mowing events", y = "Number of submissions"
  ) +
  theme_minimal()
ggsave(file.path(out_dir, "mowing_events_histogram.png"), hist_plot, width = 6, height = 4)

sampler_activity <- samples %>%
  count(sampler, name = "n_submissions") %>%
  arrange(desc(n_submissions))
cat("\nSubmissions per sampler:\n")
print(sampler_activity)
write_csv(sampler_activity, file.path(out_dir, "sampler_activity.csv"))

cat(sprintf(
  "\nNote: the app's overall \"confidence\" slider was left at its default value (5) in %.1f%% of submissions - it doesn't carry much signal on its own.\n",
  100 * mean(samples$overall_confidence == 5, na.rm = TRUE)
))

notes_n <- sum(nzchar(str_trim(raw$notes)))
cat("Submissions with a free-text note:", notes_n, "\n")

# ---------------------------------------------------------------------------
# 2. Low / very low confidence events
# ---------------------------------------------------------------------------

cat("\n==================== 2. LOW-CONFIDENCE EVENTS ====================\n\n")

low_conf_events <- event_long %>%
  filter(confidence %in% LOW_CONFIDENCE_LEVELS) %>%
  arrange(REFID, sampler, event_num)

low_conf_refids <- low_conf_events %>%
  distinct(REFID) %>%
  arrange(REFID)

cat("Individual mowing events flagged low/very low confidence:", nrow(low_conf_events), "\n")
cat("Unique REFIDs containing at least one such event:", nrow(low_conf_refids), "\n")

write_csv(low_conf_events, file.path(out_dir, "low_confidence_events.csv"))
write_csv(low_conf_refids, file.path(out_dir, "low_confidence_refids.csv"))

# ---------------------------------------------------------------------------
# 3. Interpreter agreement
# ---------------------------------------------------------------------------

cat("\n==================== 3. INTERPRETER AGREEMENT ====================\n\n")

# Greedy nearest-date matching within TOLERANCE_DAYS, mirroring the
# reference-vs-prediction matching in geo-masc/modcix's evaluation.Rmd:
# each event can only be matched once, closest pairs are matched first.
match_events <- function(dates_a, dates_b, tolerance = TOLERANCE_DAYS) {
  na <- length(dates_a)
  nb <- length(dates_b)
  if (na == 0 || nb == 0) return(0L)

  pairs <- expand.grid(i = seq_len(na), j = seq_len(nb))
  pairs$d <- abs(as.numeric(dates_a[pairs$i] - dates_b[pairs$j]))
  pairs <- pairs[pairs$d <= tolerance, ]
  pairs <- pairs[order(pairs$d), ]

  used_a <- logical(na)
  used_b <- logical(nb)
  tp <- 0L
  for (k in seq_len(nrow(pairs))) {
    i <- pairs$i[k]; j <- pairs$j[k]
    if (!used_a[i] && !used_b[j]) {
      used_a[i] <- TRUE
      used_b[j] <- TRUE
      tp <- tp + 1L
    }
  }
  tp
}

dates_lookup <- event_long %>%
  mutate(key = paste(REFID, sampler_key, sep = "||")) %>%
  group_by(key) %>%
  summarise(dates = list(sort(date)), .groups = "drop") %>%
  { setNames(.$dates, .$key) }

get_dates <- function(refid, key) {
  dates_lookup[[paste(refid, key, sep = "||")]] %||% as.Date(character())
}

meta <- samples_dedup %>%
  select(REFID, sampler, sampler_key, processed, is_grassland, n_events)

multi_refids <- meta %>%
  group_by(REFID) %>%
  filter(n_distinct(sampler_key) >= 2) %>%
  group_split()

cat("REFIDs with >=2 distinct samplers (eligible for agreement analysis):",
    length(multi_refids), "\n")

pairs_list <- map(multi_refids, function(sub) {
  keys <- unique(sub$sampler_key)
  combos <- combn(keys, 2, simplify = FALSE)
  map_dfr(combos, function(cb) {
    a <- sub %>% filter(sampler_key == cb[1]) %>% slice(1)
    b <- sub %>% filter(sampler_key == cb[2]) %>% slice(1)

    both_valid <- isTRUE(a$processed) && isTRUE(b$processed) &&
      identical(a$is_grassland, "Yes") && identical(b$is_grassland, "Yes")

    row <- tibble(
      REFID = a$REFID,
      sampler_a = a$sampler, sampler_b = b$sampler,
      grassland_a = a$is_grassland, grassland_b = b$is_grassland,
      grassland_agree = identical(a$is_grassland, b$is_grassland),
      comparable = both_valid,
      n_events_a = NA_integer_, n_events_b = NA_integer_,
      count_diff = NA_integer_, count_agree = NA,
      tp = NA_integer_, f1_timing = NA_real_
    )

    if (both_valid) {
      da <- get_dates(a$REFID, cb[1])
      db <- get_dates(a$REFID, cb[2])
      # NB: name these distinctly from row's own columns (n_events_a, tp, ...) -
      # mutate() resolves a same-named RHS against the existing column first,
      # not this enclosing scope, which would silently freeze it at its NA placeholder.
      tp_val <- match_events(da, db)
      na_n <- length(da); nb_n <- length(db)
      row <- row %>% mutate(
        n_events_a = na_n, n_events_b = nb_n,
        count_diff = na_n - nb_n, count_agree = na_n == nb_n,
        tp = tp_val,
        f1_timing = if ((na_n + nb_n) == 0) 1 else 2 * tp_val / (na_n + nb_n)
      )
    }
    row
  })
})

pairs_df <- bind_rows(pairs_list)
write_csv(pairs_df, file.path(out_dir, "sampler_pair_agreement.csv"))

cat("Sampler pairs compared:", nrow(pairs_df), "\n")
cat("  - grassland classification agreement:",
    sprintf("%.1f%%", 100 * mean(pairs_df$grassland_agree)), "\n")

comparable_pairs <- pairs_df %>% filter(comparable)
cat("  - pairs comparable on mowing counts/timing (both processed, both grassland=Yes):",
    nrow(comparable_pairs), "\n\n")

cat("Agreement on NUMBER OF CUTS (comparable pairs):\n")
cat(sprintf("  Exact match: %.1f%%\n", 100 * mean(comparable_pairs$count_agree)))
cat(sprintf("  Mean |difference| in event count: %.2f\n", mean(abs(comparable_pairs$count_diff))))
print(count(comparable_pairs, count_diff, name = "n_pairs") %>% arrange(count_diff))

cat("\nAgreement on TIMING of cut detection (comparable pairs, F1 with a",
    TOLERANCE_DAYS, "day tolerance, matching geo-masc/modcix's method):\n")
cat(sprintf("  Mean F1: %.3f\n", mean(comparable_pairs$f1_timing)))
cat(sprintf("  Perfect agreement (F1 = 1): %.1f%%\n",
            100 * mean(comparable_pairs$f1_timing == 1)))
print(summary(comparable_pairs$f1_timing))

agree_plot <- ggplot(comparable_pairs, aes(x = f1_timing)) +
  geom_histogram(binwidth = 0.1, boundary = 0, fill = "#2c7fb8", color = "white") +
  labs(
    title = paste0("Sampler pair timing agreement (F1, ", TOLERANCE_DAYS, "-day tolerance)"),
    x = "F1", y = "Number of sampler pairs"
  ) +
  theme_minimal()
ggsave(file.path(out_dir, "timing_agreement_f1_histogram.png"), agree_plot, width = 6, height = 4)

# ---------------------------------------------------------------------------
# 4. REFIDs flagged for re-verification
# ---------------------------------------------------------------------------

cat("\n==================== 4. REFIDs TO REVISIT ====================\n\n")

# Recommendation on what counts as "disagreement" worth revisiting:
#  - HIGH priority: an interpreter self-flagged low/very-low confidence on
#    one of their own events, OR the two samplers disagree on the number of
#    cuts, OR they disagree on whether it's grassland at all. All three mean
#    the two labels could point to a genuinely different reference value
#    (different NMow / GLUI class or different grassland status) - the thing
#    GRAME is ultimately validated against.
#  - MEDIUM priority: same event count, but the individual dates don't align
#    within the paper's 12-day tolerance (f1_timing < 1 despite count_agree).
#    The *number* of cuts still agrees, so this is lower-stakes for GLUI /
#    NMow but still worth a second look for the date-level validation.
# Rationale: count and grassland-status disagreement change the primary
# validation target; timing-only disagreement affects a secondary metric.
# Both are reported here so the consortium can triage under limited
# re-verification capacity - see README/analysis notes for discussion.

revisit_low_conf <- low_conf_refids %>% mutate(reason = "low_confidence_event")

revisit_grassland <- pairs_df %>%
  filter(!grassland_agree) %>%
  distinct(REFID) %>%
  mutate(reason = "grassland_classification_disagreement")

revisit_count <- comparable_pairs %>%
  filter(!count_agree) %>%
  distinct(REFID) %>%
  mutate(reason = "mowing_count_disagreement")

revisit_timing <- comparable_pairs %>%
  filter(count_agree, f1_timing < 1) %>%
  distinct(REFID) %>%
  mutate(reason = "timing_disagreement_same_count")

revisit_summary <- bind_rows(revisit_low_conf, revisit_grassland, revisit_count, revisit_timing) %>%
  group_by(REFID) %>%
  summarise(reasons = paste(sort(unique(reason)), collapse = "; "), .groups = "drop") %>%
  mutate(
    priority = if_else(
      str_detect(reasons, "low_confidence_event|mowing_count_disagreement|grassland_classification_disagreement"),
      "high", "medium"
    )
  ) %>%
  arrange(desc(priority == "high"), REFID)

write_csv(revisit_summary, file.path(out_dir, "refids_to_revisit.csv"))

cat("Total REFIDs flagged for re-verification:", nrow(revisit_summary), "\n")
print(count(revisit_summary, priority, name = "n_refids"))
cat("\nBreakdown by reason (a REFID can have more than one):\n")
print(count(bind_rows(revisit_low_conf, revisit_grassland, revisit_count, revisit_timing), reason))

cat("\nOutputs written to", out_dir, "\n")
cat(" - sampler_activity.csv\n")
cat(" - low_confidence_events.csv, low_confidence_refids.csv\n")
cat(" - sampler_pair_agreement.csv\n")
cat(" - refids_to_revisit.csv\n")
cat(" - mowing_events_histogram.png, timing_agreement_f1_histogram.png\n")
