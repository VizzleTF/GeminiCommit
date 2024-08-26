# [GeminiCommit VSCode Extension](https://github.com/VizzleTF/GeminiCommit)

GeminiCommit is a Visual Studio Code extension that automatically generates meaningful commit messages using Google's Gemini AI. This extension simplifies the process of writing clear and descriptive commit messages, saving time and improving the quality of your version control history.

## Features

- Automatically generate commit messages based on your staged changes
- Uses Google's Gemini AI for intelligent and context-aware message generation
- Easy-to-use button in the Source Control view
- Customizable API key for Google AI integration
- Supports both English and Russian languages for commit messages
- Choose between short and long commit message styles

## Installation

### Installing from VS Code Marketplace

The easiest way to install GeminiCommit is directly from the Visual Studio Code Marketplace:

1. Open Visual Studio Code
2. Go to the Extensions view (Ctrl+Shift+X or Cmd+Shift+X on macOS)
3. Search for "GeminiCommit"
4. Click on the "Install" button for the GeminiCommit extension by VizzleTF

Alternatively, you can visit the marketplace page directly:
https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit

### Installing from VSIX

If you prefer to install from a VSIX file:

1. Download the `.vsix` file from the latest release.
2. Open Visual Studio Code.
3. Go to the Extensions view (Ctrl+Shift+X or Cmd+Shift+X on macOS).
4. Click on the "..." menu in the top-right corner of the Extensions view.
5. Select "Install from VSIX..." and choose the downloaded `.vsix` file.

### Building from Source

If you want to build the extension from source, follow these steps:

1. Clone the repository:
   ```
   git clone https://github.com/VizzleTF/GeminiCommit.git
   cd GeminiCommit
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Compile the extension:
   ```
   npm run compile
   ```

4. Package the extension:
   ```
   npm install -g @vscode/vsce
   vsce package
   ```

   This will create a `.vsix` file in your project directory.

5. Install the extension in VS Code:
   - Follow steps 2-5 from the "Installing from VSIX" section above, using the `.vsix` file you just created.

## Configuration

Before using the extension, you need to set up your Google AI API key and configure your preferences:

1. Get your Google AI API key from: https://aistudio.google.com/app/apikey
2. Open VS Code settings (File > Preferences > Settings).
3. Search for "GeminiCommit" in the settings search bar.
4. Enter your Google AI API key in the "Gemini Commit: Google Api Key" field.
5. (Optional) Choose your preferred language for commit messages in the "Gemini Commit: Commit Language" dropdown.
6. (Optional) Select your preferred commit message length in the "Gemini Commit: Commit Message Length" dropdown.

### Available Settings

- **Gemini Commit: Google Api Key**: Your Google AI API key for accessing the Gemini AI service.
- **Gemini Commit: Commit Language**: Choose between "english" and "russian" for the language of generated commit messages.
- **Gemini Commit: Commit Message Length**: Choose between "short" and "long" for the style of generated commit messages.
  - Short: Concise, single-line commit messages (up to 50 characters).
  - Long: More detailed commit messages with up to 3 lines, providing more context about the changes.

## Usage

1. Stage your changes in Git as you normally would.
2. In the Source Control view, look for the "GeminiCommit" section.
3. Click on the "Generate Commit Message" button.
4. The extension will analyze your staged changes and generate a commit message.
5. The generated message will be automatically inserted into the commit message input box.
6. Review and edit the message if needed, then commit as usual.

## Requirements

- Visual Studio Code version 1.75.0 or higher
- Git installed and configured in your workspace
- Active Google AI API key
- For building from source:
  - Node.js and npm installed on your system
  - Basic knowledge of TypeScript and VS Code extension development

## Known Issues

Please report any issues or suggest improvements on our [GitHub Issues](https://github.com/VizzleTF/GeminiCommit/issues) page.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- Thanks to Google for providing the Gemini AI API
- Inspired by the need for quick and meaningful commit messages in development workflows

## Support

If you encounter any problems or have any questions, please open an issue on the [GitHub repository](https://github.com/VizzleTF/GeminiCommit/issues).

---

## Краткая инструкция по установке (на русском)

1. Установите расширение GeminiCommit из [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit).
2. Получите API ключ Google AI на странице: https://aistudio.google.com/app/apikey
3. Откройте настройки VS Code (Файл > Параметры > Настройки).
4. Найдите "GeminiCommit" в строке поиска настроек.
5. Введите ваш API ключ Google AI в поле "Gemini Commit: Google Api Key".
6. (Опционально) Выберите предпочитаемый язык для сообщений коммитов в выпадающем списке "Gemini Commit: Commit Language".
7. (Опционально) Выберите предпочитаемую длину сообщений коммитов в выпадающем списке "Gemini Commit: Commit Message Length".

---

Enjoy using GeminiCommit! We hope it enhances your development workflow and improves your commit message quality.