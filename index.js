const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const http = require("http");

// Prosty serwer HTTP wymagany przez Render, aby uniknąć błędu "No open ports detected"
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot dziala poprawnie!\n");
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serwer HTTP nasłuchuje na porcie ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// --- KONFIGURACJA ---
const nazwaRoli = "・Members"; // Nazwa roli nadawanej po weryfikacji
const ID_KANALU_LOGOW = "1531657727397462046"; // ID kanału na logi
// --------------------

// Przechowalnia weryfikacji w pamięci: { discordUserId: { robloxUsername, robloxId, code } }
const pendingVerifications = new Map();

const commands = [
    new SlashCommandBuilder()
        .setName("weryfikacja")
        .setDescription("Rozpocznij proces weryfikacji konta Roblox")
        .addStringOption(option => 
            option.setName("nazwa")
                  .setDescription("Twoja dokładna nazwa użytkownika w Roblox")
                  .setRequired(true))
].map(command => command.toJSON());

client.once("clientReady", async () => {
    console.log(`Bot działa jako ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log("Pomyślnie zarejestrowano komendy slash.");
    } catch (error) {
        console.error(error);
    }
});

client.on("interactionCreate", async interaction => {
    // 1. Obsługa komendy /weryfikacja
    if (interaction.isChatInputCommand() && interaction.commandName === "weryfikacja") {
        const robloxUser = interaction.options.getString("nazwa");
        const discordId = interaction.user.id;

        // Pobieramy ID użytkownika z Roblox za pomocą oficjalnego API Roblox
        try {
            const userSearchRes = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usernames: [robloxUser], excludeBannedUsers: true })
            });
            const userData = await userSearchRes.json();

            if (!userData.data || userData.data.length === 0) {
                return interaction.reply({
                    content: `❌ Nie znaleziono gracza o nazwie **${robloxUser}** na platformie Roblox. Sprawdź poprawność wpisanej nazwy.`,
                    ephemeral: true
                });
            }

            const robloxId = userData.data[0].id;
            const verifiedCode = `RBX-${Math.floor(1000 + Math.random() * 9000)}`;

            // Zapisujemy dane do pamięci bota
            pendingVerifications.set(discordId, {
                robloxUsername: robloxUser,
                robloxId: robloxId,
                code: verifiedCode
            });

            // Tworzymy przycisk do sprawdzenia
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("check_verification")
                    .setLabel("Sprawdź weryfikację")
                    .setStyle(ButtonStyle.Success)
            );

            const embed = new EmbedBuilder()
                .setTitle("Weryfikacja konta Roblox")
                .setColor(0x00AE86)
                .setDescription(`Kroki do ukończenia weryfikacji dla **${robloxUser}**:\n\n1. Wejdź na swój profil na Roblox.\n2. Zmień swój **Opis (Bio)** na poniższy kod:\n\`\`\`${verifiedCode}\`\`\`\n3. Gdy już to zrobisz, kliknij przycisk **Sprawdź weryfikację** poniżej.`)
                .setFooter({ text: "Kod można usunąć z profilu po zakończeniu weryfikacji." });

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `❌ Wystąpił błąd podczas kontaktowania się z API Roblox. Spróbuj ponownie później.`,
                ephemeral: true
            });
        }
    }

    // 2. Obsługa kliknięcia przycisku "Sprawdź weryfikację"
    if (interaction.isButton() && interaction.customId === "check_verification") {
        const discordId = interaction.user.id;
        const data = pendingVerifications.get(discordId);

        if (!data) {
            return interaction.reply({
                content: `❌ Nie znaleziono aktywnej sesji weryfikacyjnej. Wpisz komendę \`/weryfikacja\` ponownie.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Pobieramy opis profilu gracza z Roblox API
            const profileRes = await fetch(`https://users.roblox.com/v1/users/${data.robloxId}`);
            const profileData = await profileRes.json();

            const bio = profileData.description || "";

            // Sprawdzamy, czy wygenerowany kod znajduje się w opisie profilu
            if (bio.includes(data.code)) {
                // Sukces! Nadajemy rolę
                const member = interaction.member;
                const role = interaction.guild.roles.cache.find(r => r.name === nazwaRoli);

                if (!role) {
                    return interaction.editReply({ content: `❌ Błąd konfiguracji bota: Nie znaleziono roli **${nazwaRoli}** na tym serwerze.` });
                }

                await member.roles.add(role);
                pendingVerifications.delete(discordId);

                await interaction.editReply({ content: `✅ **Weryfikacja powiodła się!** Konto zostało pomyślnie powiązane z graczem **${data.robloxUsername}**. Przyznano rolę!` });

                // Wysyłamy log na wyznaczony kanał Discord
                const logChannel = interaction.guild.channels.cache.get(ID_KANALU_LOGOW);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("Nowa weryfikacja gracza!")
                        .setColor(0x00FF00)
                        .addFields(
                            { name: "Użytkownik Discord", value: `<@${discordId}> (${interaction.user.tag})`, inline: true },
                            { name: "Nazwa Roblox", value: data.robloxUsername, inline: true }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }

            } else {
                // Kod nie został znaleziony w bio
                await interaction.editReply({ content: `❌ Nie znaleziono kodu **${data.code}** w opisie (Bio) Twojego profilu Roblox. Upewnij się, że został wklejony i zapisany, a następnie spróbuj ponownie.` });
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas sprawdzania profilu Roblox. Spróbuj ponownie.` });
        }
    }
});

client.login(process.env.TOKEN);
