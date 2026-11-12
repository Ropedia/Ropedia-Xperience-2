# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
"""Read-only access to local exported data; no cloud credentials are needed."""
import os
import re
from pathlib import Path


class Source:
    def __init__(self, location):
        root = Path(location).expanduser().resolve()
        if not root.is_dir():
            raise ValueError(f'input must be an existing local directory: {location}')
        self.prefix = str(root) + os.sep
        self.local = True
        self._listing = None

    def listing(self):
        if self._listing is None:
            self._listing = {}
            for directory, _, filenames in os.walk(self.prefix):
                for name in filenames:
                    path = os.path.join(directory, name)
                    self._listing[os.path.relpath(path, self.prefix)] = os.path.getsize(path)
        return self._listing

    def find(self, pattern):
        regex = re.compile(pattern)
        return sorted(key for key in self.listing() if regex.search(key))

    def path(self, relative):
        return os.path.join(self.prefix, relative)

    def open(self, relative):
        return open(self.path(relative), 'rb')
