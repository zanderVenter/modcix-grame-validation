# Project configuration loader (R). Mirrors src/config.py.
# Reads config/.env (git-ignored) and resolves ${VAR} placeholders in
# config/catalog.yaml against it. Run scripts from the repo root so the
# relative "config/..." paths below resolve correctly.

library(yaml)

`%||%` <- function(a, b) if (is.null(a)) b else a

load_env <- function(path = "config/.env") {
  if (!file.exists(path)) {
    stop("config/.env not found - copy config/template.env to config/.env ",
         "and fill in your values (see README.md).")
  }
  lines <- readLines(path, warn = FALSE)
  lines <- lines[nzchar(trimws(lines)) & !grepl("^\\s*#", lines)]
  for (line in lines) {
    parts <- strsplit(line, "=", fixed = TRUE)[[1]]
    key <- trimws(parts[1])
    value <- trimws(paste(parts[-1], collapse = "="))
    do.call(Sys.setenv, setNames(list(value), key))
  }
}

# Replace a single ${VAR} placeholder in each string leaf of a nested list.
resolve_env_vars <- function(x) {
  if (is.list(x)) {
    return(lapply(x, resolve_env_vars))
  }
  if (is.character(x) && grepl("^\\$\\{[^}]+\\}$", x)) {
    var <- sub("^\\$\\{", "", sub("\\}$", "", x))
    val <- Sys.getenv(var, unset = NA)
    if (is.na(val)) stop("Undefined environment variable ", var, " in config")
    return(val)
  }
  x
}

load_catalog <- function() {
  load_env()
  resolve_env_vars(yaml::read_yaml("config/catalog.yaml"))
}
