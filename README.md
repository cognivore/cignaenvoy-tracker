# Cigna Envoy Tracker

A guide and toolkit for using LLMs and Local-First Databases to submit Cigna Envoy documents.

## Setup

This project uses Nix flakes for reproducible development environments.

```bash
# Enter the development shell
nix develop

# Or with direnv (auto-activates on cd)
direnv allow

# Install Node.js dependencies
pnpm install
```

## E2E Testing

End-to-end tests use Selenium WebDriver with headless Chrome.

```bash
# Run all e2e tests
pnpm test:e2e
```

### Requirements

- Chrome/Chromium browser (provided by Nix on Linux)
- ChromeDriver (provided by Nix)
- On Linux: xvfb-run for headless display (provided by Nix)

## Project Structure

```
cignaenvoy-tracker/
├── flake.nix           # Nix development environment
├── .envrc              # direnv integration
├── package.json        # Node.js dependencies
├── tests/
│   └── e2e/
│       ├── setup.js    # WebDriver factory + utilities
│       └── *.test.js   # Test files
└── README.md
```

## License

MIT
