# Lehrerranking

Ein einmaliges Quiz, bei dem in mehreren Kategorien die am besten passende Lehrkraft
gewählt wird. Die Ergebnisse werden erst ab einem festgelegten Datum sichtbar. Alles
läuft als statische Seite (z. B. auf GitHub Pages) mit einer kleinen kostenlosen
Firebase-Datenbank im Hintergrund, damit Fragen, Lehrkräfte und Stimmen für alle
Besucher:innen gemeinsam gespeichert werden.

## Warum Firebase?

GitHub Pages liefert nur statische Dateien aus – es gibt keinen eigenen Server und
keine Datenbank. Damit der Admin-Bereich Änderungen speichert, die dann alle sehen,
und damit Stimmen aller Teilnehmenden zusammengezählt werden können, braucht es
irgendeine Datenbank im Hintergrund. Firebase (Firestore) ist dafür kostenlos im
Rahmen dieses Projekts völlig ausreichend und ohne eigenen Server nutzbar.

## 1. Firebase-Projekt einrichten (einmalig, ca. 10 Minuten)

1. Gehe zu https://console.firebase.google.com und erstelle ein neues Projekt
   (z. B. "lehrerranking"). Google Analytics kannst du dabei deaktivieren.
2. Klicke im Projekt links auf **Build → Firestore Database → Datenbank erstellen**.
   Wähle einen Standort in deiner Nähe (z. B. `eur3 (Europe)`) und starte im
   **Produktionsmodus**.
3. Klicke links auf **Build → Authentication → Los geht's**. Aktiviere den
   Anmeldeanbieter **E-Mail/Passwort**.
4. Wechsle im Authentication-Bereich zum Reiter **Nutzer** und lege manuell einen
   Nutzer an, z. B.:
   - E-Mail: `admin@lehrerranking.local`
   - Passwort: `MB2026!`

   Das ist der Zugang für den Admin-Bereich (`admin.html`). Vergib die E-Mail-Adresse
   frei nach Belieben, sie muss nicht echt sein.
5. Klicke links oben auf das Zahnrad → **Projekteinstellungen**. Scrolle zu
   **Meine Apps**, klicke auf das Web-Symbol (`</>`) und registriere eine neue
   Web-App (kein Hosting aktivieren). Du erhältst einen `firebaseConfig`-Block.
6. Trage diese Werte in `js/firebase-config.js` ein (die Datei liegt in diesem
   Projekt und ist dafür vorgesehen).

## 2. Sicherheitsregeln setzen

Öffne in der Firebase-Konsole **Firestore Database → Regeln** und ersetze den
Inhalt durch Folgendes:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /config/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /teachers/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /questions/{docId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /votes/{docId} {
      allow create, update: if request.resource.data.keys().hasOnly(['answers', 'updatedAt']);
      allow delete: if false;
      // Einzelne Stimme (die eigene, per Geraete-ID) darf jederzeit gelesen werden -
      // das braucht die Seite, um zu erkennen "hast du schon abgestimmt".
      allow get: if true;
      // Die GESAMTE Sammlung (fuer die Auswertung) ist entweder fuer angemeldete
      // Admins jederzeit lesbar (Uebersicht/Log), oder fuer alle ab dem
      // Veroeffentlichungsdatum.
      allow list: if request.auth != null
        || request.time >= get(/databases/$(database)/documents/config/settings).data.publishAt;
    }
  }
}
```

Das bedeutet:
- Einstellungen, Lehrkräfte und Fragen kann jede:r lesen, aber nur ändern, wer im
  Admin-Bereich angemeldet ist.
- Jede:r kann abstimmen bzw. die eigene Stimme ändern.
- Die eigene, einzelne Stimme ist jederzeit abrufbar (nötig, damit "Antworten
  ändern" funktioniert).
- Die komplette Liste aller Stimmen ist für die angemeldete Admin-Ansicht
  (Übersicht/Log) jederzeit einsehbar, für alle anderen erst ab dem
  Veröffentlichungsdatum.

**Hinweis zur Sicherheit:** Der Admin-Bereich ist über einen echten Firebase-Login
geschützt (E-Mail + Passwort), keine reine Fassade im Browser. Wer die Zugangsdaten
kennt, kann Einstellungen, Lehrkräfte und Fragen ändern. Behandle das Passwort
entsprechend vertraulich.

## 3. Auf GitHub veröffentlichen

1. Lade den gesamten Ordner in ein neues GitHub-Repository hoch (z. B. per
   GitHub Desktop oder `git init`, `git add .`, `git commit`, `git push`).
2. Gehe im Repository zu **Settings → Pages**.
3. Wähle bei **Source** den Branch `main` und den Ordner `/ (root)`.
4. Nach kurzer Zeit ist die Seite unter `https://DEIN-NUTZERNAME.github.io/DEIN-REPO/`
   erreichbar.
5. Der Admin-Bereich liegt unter derselben Adresse mit `/admin.html` am Ende.

## 4. Inhalte befüllen

Öffne `admin.html`, melde dich mit `admin@lehrerranking.local` / `MB2026!` an
(oder der E-Mail-Adresse, die du gewählt hast) und trage ein:

- **Einstellungen:** Titel der Startseite, Einleitungstext, Veröffentlichungsdatum
  der Ergebnisse.
- **Lehrkräfte:** Namen (und optional Fach) aller Lehrkräfte zur Auswahl.
- **Fragen:** die Kategorien/Fragen des Quiz, in der gewünschten Reihenfolge
  (mit den Pfeil-Buttons sortierbar).

## Ergebnisse und Auswertung

Ab dem eingestellten Veröffentlichungsdatum zeigt die Startseite beim Aufruf
automatisch zuerst eine kurze Animation ("X Personen haben abgestimmt") und dann
direkt die Ergebnisse – ohne dass etwas angeklickt werden muss. Ist die Seite
bereits geöffnet, wenn der Zeitpunkt erreicht wird, wechselt sie automatisch dorthin.

In der Ergebnisansicht:
- Jede Frage lässt sich einzeln aufklappen und zeigt die Top 5 der jeweiligen
  Kategorie als Säulendiagramm.
- Über die Suchleiste lässt sich gezielt nach einer Lehrkraft suchen; angezeigt
  werden dann ihre genauen Stimmenzahlen in jeder einzelnen Kategorie.
- Über "Meine Antworten bearbeiten" lässt sich die eigene Stimme auch nach der
  Veröffentlichung noch ändern.

Im Admin-Bereich zeigt der Reiter **Übersicht** unabhängig vom
Veröffentlichungsdatum jederzeit die Gesamtzahl der Stimmen sowie ein Log der
zuletzt gespeicherten Stimmabgaben (Zeitpunkt, ohne Rückschluss darauf, wer
abgestimmt hat).

## Wie das Mehrfach-Abstimmen verhindert wird

Beim ersten Start des Quiz erzeugt der Browser eine zufällige Kennung und
speichert sie in `localStorage`. Diese Kennung dient als Dokument-ID der
gespeicherten Stimme. Ein erneuter Aufruf desselben Geräts/Browsers erkennt die
vorhandene Stimme und öffnet automatisch den Bearbeiten-Modus, statt eine
zweite Stimme anzulegen. Wird der Browser-Speicher gelöscht oder ein anderes
Gerät verwendet, lässt sich das nicht verhindern – für ein internes
Schul-Voting ist das ein bewusster, einfacher Kompromiss ohne Nutzerkonten.

## Projektstruktur

```
index.html          Startseite, Quiz, Ergebnisanzeige
admin.html           Admin-Bereich
css/styles.css        gemeinsames Design
js/firebase-config.js  eigene Firebase-Zugangsdaten (hier eintragen)
js/firebase-init.js    Firebase-Initialisierung
js/app.js              Logik der Quiz-Seite
js/admin.js             Logik des Admin-Bereichs
```
