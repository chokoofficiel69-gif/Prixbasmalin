import unittest

from scripts.preview_fuel_prices import load_xml, parse_xml


class FuelPreviewTests(unittest.TestCase):
    def test_parses_station_and_fuel_without_writing_files(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <pdv_liste>
          <pdv id="123" cp="69009"><adresse>1 rue test</adresse><ville>Lyon</ville>
            <prix nom="Gazole" id="1" maj="2026-10-25T10:00:00" valeur="1.789"/>
            <prix nom="SP95" id="2" maj="2026-10-25T10:00:00" valeur="1.899"/>
          </pdv>
        </pdv_liste>"""
        result = parse_xml(xml)
        self.assertEqual(result["stations"], 1)
        self.assertEqual(result["prices"], 2)
        self.assertEqual(result["sample"][0]["fuel"], "Gazole")
        self.assertEqual(result["sample"][0]["price_eur_litre"], "1.789")

    def test_load_xml_accepts_plain_xml(self):
        xml = b"<pdv_liste><pdv id='1' cp='00000'/></pdv_liste>"
        self.assertEqual(load_xml(xml), xml)


if __name__ == "__main__":
    unittest.main()
